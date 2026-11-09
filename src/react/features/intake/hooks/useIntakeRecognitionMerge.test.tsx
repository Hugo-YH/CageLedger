import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { IntakeReviewPreview, IntakeSaveRequest, IntakeWriteResponse } from "../../../../contracts/intake";
import { createIntakeDraft } from "../../../../domain/intake";
import { previewIntakeReview } from "../../../api/intake";
import { ApiError } from "../../../api/client";
import { useIntakeRecognitionMerge } from "./useIntakeRecognitionMerge";

vi.mock("../../../api/intake", () => ({ previewIntakeReview: vi.fn() }));
const incoming = { ...createIntakeDraft("录入人"), rawMessage: "待补充文字", batchNo: "B1", intakeDate: "2026-11-03" };
const original = { ...createIntakeDraft("图片录入人"), id: "saved-image", updatedAt: "v1", quantity: 30 };
const merged = { ...original, intakeDate: incoming.intakeDate };
function previewResult(): IntakeReviewPreview {
  return {
    reviewVersion: 2,
    outcome: "supplement",
    sourceIssues: [],
    incoming,
    total: 1,
    items: [
      {
        item: original,
        reviewStatus: "supplement",
        canAcknowledge: true,
        comparisons: [],
        matchedFields: ["batchNo"],
        classification: "batch_only",
        canMerge: true,
        reason: "图片优先",
        mergedItem: merged,
        changes: [],
        confirmationToken: "preview-token",
      },
    ],
  };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
function resolvablePreview(): IntakeReviewPreview {
  const response = previewResult();
  response.items[0].resolutionFields = ["quantity", "endDate"];
  response.items[0].resolutions = { quantity: "saved", endDate: "saved" };
  response.items[0].canAcknowledge = false;
  return response;
}
function setup() {
  const revision = { current: 1 };
  const saveInFlight = { current: false };
  const save = { mutateAsync: vi.fn<(request: unknown) => Promise<IntakeWriteResponse>>() };
  const onSaved = vi.fn();
  const hook = renderHook(() => useIntakeRecognitionMerge({ revision, save, saveInFlight, onSaved }));
  return { ...hook, revision, saveInFlight, save, onSaved };
}
beforeEach(() => vi.mocked(previewIntakeReview).mockReset());
afterEach(cleanup);

it("only previews the recognized draft, excludes an edited ID and does not write before confirmation", async () => {
  vi.mocked(previewIntakeReview).mockResolvedValue(previewResult());
  const { result, save } = setup();
  await act(() => result.current.preview(incoming, "current-editor"));
  expect(previewIntakeReview).toHaveBeenCalledExactlyOnceWith(incoming, "current-editor", [], expect.any(AbortSignal));
  expect(result.current.state?.incoming).toEqual(incoming);
  expect(save.mutateAsync).not.toHaveBeenCalled();
  act(() => result.current.close());
  expect(result.current.state).toBeNull();
  expect(incoming.rawMessage).toBe("待补充文字");
});

it("retains recognized text after a preview failure and retries the same draft", async () => {
  vi.mocked(previewIntakeReview)
    .mockRejectedValueOnce(new Error("匹配暂不可用"))
    .mockResolvedValueOnce(previewResult());
  const { result, save } = setup();
  await act(() => result.current.preview(incoming));
  expect(result.current.state).toMatchObject({ incoming, checking: false, error: "匹配暂不可用" });
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.state?.checking).toBe(false));
  expect(result.current.state?.result?.total).toBe(1);
  expect(previewIntakeReview).toHaveBeenCalledTimes(2);
  expect(save.mutateAsync).not.toHaveBeenCalled();
});

it("leaves an unmatched recognized draft on the normal save path without an error or automatic write", async () => {
  vi.mocked(previewIntakeReview).mockResolvedValue({ ...previewResult(), items: [], total: 0, outcome: "unmatched" });
  const { result, save } = setup();
  await act(() => result.current.preview(incoming));
  expect(result.current.state).toMatchObject({ incoming, checking: false, error: "", result: { items: [], total: 0 } });
  await act(() => result.current.confirm());
  expect(save.mutateAsync).not.toHaveBeenCalled();
});

it("updates the server-provided original exactly once, keeps text after save failure and can retry", async () => {
  vi.mocked(previewIntakeReview).mockResolvedValue(previewResult());
  const { result, save, onSaved } = setup();
  const firstSave = deferred<IntakeWriteResponse>();
  save.mutateAsync
    .mockReturnValueOnce(firstSave.promise)
    .mockResolvedValueOnce({ item: { ...merged, updatedAt: "v2" } });
  await act(() => result.current.preview(incoming));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.confirm();
    void result.current.confirm();
  });
  expect(save.mutateAsync).toHaveBeenCalledExactlyOnceWith({
    item: merged,
    exists: true,
    checkDuplicates: true,
    reviewVersion: 2,
    recognitionImages: [],
    recognitionMerge: { reviewVersion: 2, incoming, confirmationToken: "preview-token" },
  });
  act(() => result.current.close());
  expect(result.current.state?.saving).toBe(true);
  await act(async () => {
    firstSave.reject(new Error("版本已更新"));
    await pending;
  });
  expect(result.current.state).toMatchObject({ incoming, saving: false, saveError: "版本已更新" });
  expect(onSaved).not.toHaveBeenCalled();
  await act(() => result.current.confirm());
  expect(onSaved).toHaveBeenCalledExactlyOnceWith({ ...merged, updatedAt: "v2" }, undefined, null);
  expect(result.current.state).toBeNull();
});

it.each(["multiple", "blocked", "missing-token"])("never confirms an ineligible preview (%s)", async (kind) => {
  const response = previewResult();
  if (kind === "multiple") {
    response.total = 2;
    response.items.push({ ...response.items[0], item: { ...original, id: "other" } });
  }
  if (kind === "blocked") response.items[0].canMerge = false;
  if (kind === "missing-token") response.items[0].confirmationToken = "";
  vi.mocked(previewIntakeReview).mockResolvedValue(response);
  const { result, save } = setup();
  await act(() => result.current.preview(incoming));
  await act(() => result.current.confirm());
  expect(save.mutateAsync).not.toHaveBeenCalled();
});

it("requires a fresh preview after a 409 instead of replaying a stale merge token", async () => {
  const refreshed = previewResult();
  refreshed.items[0].confirmationToken = "refreshed-token";
  vi.mocked(previewIntakeReview).mockResolvedValueOnce(previewResult()).mockResolvedValueOnce(refreshed);
  const { result, save } = setup();
  save.mutateAsync
    .mockRejectedValueOnce(new ApiError("预约已更新，请重新匹配", 409, {}))
    .mockResolvedValueOnce({ item: merged });
  await act(() => result.current.preview(incoming));
  await act(() => result.current.confirm());
  expect(result.current.state?.needsRefresh).toBe(true);
  await act(() => result.current.confirm());
  expect(save.mutateAsync).toHaveBeenCalledOnce();
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.state?.result?.items[0].confirmationToken).toBe("refreshed-token"));
  await act(() => result.current.confirm());
  expect(save.mutateAsync).toHaveBeenLastCalledWith(
    expect.objectContaining({ recognitionMerge: { reviewVersion: 2, incoming, confirmationToken: "refreshed-token" } }),
  );
});

it("ignores late previews after a new draft revision and after unmount", async () => {
  const read = deferred<IntakeReviewPreview>();
  vi.mocked(previewIntakeReview).mockReturnValue(read.promise);
  const { result, revision, rerender, unmount, save } = setup();
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.preview(incoming);
  });
  const signal = vi.mocked(previewIntakeReview).mock.calls[0][3]!;
  expect(signal.aborted).toBe(false);
  revision.current += 1;
  rerender();
  expect(signal.aborted).toBe(true);
  expect(result.current.state).toBeNull();
  unmount();
  await act(async () => {
    read.resolve(previewResult());
    await pending;
  });
  expect(save.mutateAsync).not.toHaveBeenCalled();
});

it("cancels superseded and closed preview requests without allowing their late results to reopen the dialog", async () => {
  const first = deferred<IntakeReviewPreview>();
  const second = deferred<IntakeReviewPreview>();
  vi.mocked(previewIntakeReview).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
  const { result } = setup();
  let firstPending!: Promise<void>;
  let secondPending!: Promise<void>;
  act(() => {
    firstPending = result.current.preview(incoming);
  });
  const firstSignal = vi.mocked(previewIntakeReview).mock.calls[0][3]!;
  act(() => {
    secondPending = result.current.preview({ ...incoming, batchNo: "NEW" });
  });
  const secondSignal = vi.mocked(previewIntakeReview).mock.calls[1][3]!;
  expect(firstSignal.aborted).toBe(true);
  expect(secondSignal.aborted).toBe(false);
  await act(async () => {
    first.resolve(previewResult());
    await firstPending;
  });
  expect(result.current.state).toMatchObject({ incoming: { batchNo: "NEW" }, checking: true, result: null });
  act(() => result.current.close());
  expect(secondSignal.aborted).toBe(true);
  await act(async () => {
    second.resolve(previewResult());
    await secondPending;
  });
  expect(result.current.state).toBeNull();
});

it("aborts only the private preview request on unmount", async () => {
  const read = deferred<IntakeReviewPreview>();
  vi.mocked(previewIntakeReview).mockReturnValue(read.promise);
  const { result, unmount } = setup();
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.preview(incoming);
  });
  const signal = vi.mocked(previewIntakeReview).mock.calls[0][3]!;
  unmount();
  expect(signal.aborted).toBe(true);
  await act(async () => {
    read.resolve(previewResult());
    await pending;
  });
});

it("does not reset a newer draft when an earlier merge write finishes", async () => {
  vi.mocked(previewIntakeReview).mockResolvedValue(previewResult());
  const write = deferred<IntakeWriteResponse>();
  const { result, revision, rerender, save, onSaved } = setup();
  save.mutateAsync.mockReturnValue(write.promise);
  await act(() => result.current.preview(incoming));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.confirm();
  });
  revision.current += 1;
  rerender();
  await act(async () => {
    write.resolve({ item: merged });
    await pending;
  });
  expect(onSaved).not.toHaveBeenCalled();
  expect(result.current.state).toBeNull();
});

it("lets the server explain insufficient identifiers instead of claiming an unmatched appointment", async () => {
  vi.mocked(previewIntakeReview).mockResolvedValue({
    ...previewResult(),
    items: [],
    total: 0,
    outcome: "insufficient",
  });
  const { result } = setup();
  await act(() => result.current.preview({ ...incoming, batchNo: "", purchaseOrderNo: "" }));
  expect(previewIntakeReview).toHaveBeenCalledOnce();
  expect(result.current.state?.result?.outcome).toBe("insufficient");
});

it("still previews an order-only source with no purchase ID or batch number", async () => {
  const preview = previewResult();
  preview.items[0].classification = "order_only";
  preview.items[0].matchedFields = ["orderNo"];
  vi.mocked(previewIntakeReview).mockResolvedValue(preview);
  const { result } = setup();
  const orderOnly = { ...incoming, batchNo: "", purchaseOrderNo: "", orderNo: "DC202611022948607" };
  await act(() => result.current.preview(orderOnly));
  expect(previewIntakeReview).toHaveBeenCalledExactlyOnceWith(orderOnly, undefined, [], expect.any(AbortSignal));
});

it("acknowledges an existing appointment without writing and ignores acknowledgement after a newer draft", async () => {
  const response = previewResult();
  response.outcome = "registered";
  const revision = { current: 1 };
  const onAcknowledge = vi.fn();
  const onEdit = vi.fn();
  const save = { mutateAsync: vi.fn<(_request: IntakeSaveRequest) => Promise<IntakeWriteResponse>>() };
  vi.mocked(previewIntakeReview).mockResolvedValue(response);
  const { result, rerender } = renderHook(() =>
    useIntakeRecognitionMerge({
      revision,
      save,
      saveInFlight: { current: false },
      onSaved: vi.fn(),
      onAcknowledge,
      onEdit,
    }),
  );
  await act(() => result.current.preview(incoming));
  act(() => result.current.acknowledge(original.id));
  expect(onAcknowledge).toHaveBeenCalledOnce();
  expect(save.mutateAsync).not.toHaveBeenCalled();
  await act(() => result.current.preview(incoming));
  revision.current += 1;
  rerender();
  act(() => {
    result.current.acknowledge(original.id);
    result.current.edit(original.id);
  });
  expect(onAcknowledge).toHaveBeenCalledOnce();
  expect(onEdit).not.toHaveBeenCalled();
});

it("keeps the same image input identity through preview, failed confirmation and explicit recheck", async () => {
  const images = [{ name: "新截图.png", dataUrl: "data:image/png;base64,eA==" }];
  const snapshotImages = vi.fn(() => images);
  const revision = { current: 1 };
  const save = {
    mutateAsync: vi
      .fn<(_request: IntakeSaveRequest) => Promise<IntakeWriteResponse>>()
      .mockRejectedValue(new ApiError("版本冲突", 409, {})),
  };
  vi.mocked(previewIntakeReview).mockResolvedValue(previewResult());
  const { result } = renderHook(() =>
    useIntakeRecognitionMerge({ revision, save, snapshotImages, saveInFlight: { current: false }, onSaved: vi.fn() }),
  );
  await act(() => result.current.preview(incoming));
  await act(() => result.current.confirm(original.id));
  expect(save.mutateAsync.mock.calls[0][0].recognitionImages?.[0]).toBe(images[0]);
  snapshotImages.mockReturnValue([]);
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.state?.checking).toBe(false));
  expect(vi.mocked(previewIntakeReview).mock.calls[1][2]?.[0]).toBe(images[0]);
  expect(snapshotImages).toHaveBeenCalledOnce();
});

it("reviews a duplicate save's captured intent in the same area and only edits the explicitly chosen original", () => {
  const response = previewResult();
  response.items.push({
    ...response.items[0],
    item: { ...original, id: "related" },
    canMerge: false,
    canAcknowledge: false,
  });
  response.total = 2;
  const revision = { current: 1 };
  const intent = {
    item: incoming,
    exists: false,
    draftRevision: 1,
    mode: "entry" as const,
    recognitionImages: [{ name: "冻结图.png", dataUrl: "data:image/png;base64,eA==" }],
  };
  const onEdit = vi.fn();
  const onCloseReview = vi.fn();
  const save = { mutateAsync: vi.fn<(_request: IntakeSaveRequest) => Promise<IntakeWriteResponse>>() };
  const duplicate = {
    intent,
    details: { items: [], total: 2, confirmationToken: "duplicate-token", review: response },
    error: "",
  };
  const { result } = renderHook(() =>
    useIntakeRecognitionMerge({
      revision,
      save,
      saveInFlight: { current: false },
      onSaved: vi.fn(),
      onEdit,
      onCloseReview,
      duplicate,
    }),
  );
  expect(result.current.state?.intent).toBe(intent);
  expect(result.current.state?.images[0]).toBe(intent.recognitionImages[0]);
  act(() => result.current.edit("related"));
  expect(onEdit).toHaveBeenCalledExactlyOnceWith(response.items[1].item);
  expect(onCloseReview).toHaveBeenCalledOnce();
  expect(save.mutateAsync).not.toHaveBeenCalled();
});

it("allows the server's sole eligible target even when other records only share a related purchase number", async () => {
  const response = previewResult();
  response.total = 2;
  response.items.push({
    ...response.items[0],
    item: { ...original, id: "other" },
    canMerge: false,
    canAcknowledge: false,
  });
  vi.mocked(previewIntakeReview).mockResolvedValue(response);
  const { result, save } = setup();
  save.mutateAsync.mockResolvedValue({ item: merged });
  await act(() => result.current.preview(incoming));
  await act(() => result.current.confirm(original.id));
  expect(save.mutateAsync).toHaveBeenCalledOnce();
  expect(save.mutateAsync.mock.calls[0][0]).toMatchObject({ item: { id: original.id, updatedAt: "v1" } });
});

it("keeps the old preview while checking a field choice and confirms only the explicit raw choice with the new token", async () => {
  const initial = resolvablePreview();
  const read = deferred<IntakeReviewPreview>();
  const resolved = resolvablePreview();
  resolved.items[0] = {
    ...resolved.items[0],
    resolutions: { quantity: "incoming", endDate: "saved" },
    mergedItem: { ...merged, quantity: 15 },
    confirmationToken: "chosen-token",
  };
  vi.mocked(previewIntakeReview).mockResolvedValueOnce(initial).mockReturnValueOnce(read.promise);
  const { result, save } = setup();
  save.mutateAsync.mockResolvedValue({ item: { ...merged, quantity: 15 } });
  await act(() => result.current.preview(incoming));
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.resolveField(original.id, "quantity", "incoming")!;
    void result.current.confirm(original.id);
  });
  expect(result.current.state).toMatchObject({ checking: true, incoming, resolutions: { quantity: "incoming" } });
  expect(result.current.state?.result).toBe(initial);
  expect(previewIntakeReview).toHaveBeenLastCalledWith(incoming, undefined, [], expect.any(AbortSignal), {
    quantity: "incoming",
  });
  expect(save.mutateAsync).not.toHaveBeenCalled();
  await act(async () => {
    read.resolve(resolved);
    await pending;
  });
  await act(() => result.current.confirm(original.id));
  expect(save.mutateAsync).toHaveBeenCalledExactlyOnceWith(
    expect.objectContaining({
      item: { ...merged, quantity: 15 },
      recognitionMerge: {
        reviewVersion: 2,
        incoming,
        confirmationToken: "chosen-token",
        resolutions: { quantity: "incoming" },
      },
    }),
  );
});

it("retains an unsuccessful field choice for an explicit retry without submitting the old preview", async () => {
  const initial = resolvablePreview();
  const refreshed = resolvablePreview();
  refreshed.items[0].confirmationToken = "retried-choice-token";
  refreshed.items[0].resolutions = { quantity: "incoming", endDate: "saved" };
  vi.mocked(previewIntakeReview)
    .mockResolvedValueOnce(initial)
    .mockRejectedValueOnce(new Error("选择核对暂不可用"))
    .mockResolvedValueOnce(refreshed);
  const { result, save } = setup();
  save.mutateAsync.mockResolvedValue({ item: merged });
  await act(() => result.current.preview(incoming));
  await act(() => result.current.resolveField(original.id, "quantity", "incoming"));
  expect(result.current.state).toMatchObject({
    result: initial,
    checking: false,
    needsRefresh: true,
    error: "选择核对暂不可用",
    resolutions: { quantity: "incoming" },
  });
  await act(() => result.current.confirm(original.id));
  expect(save.mutateAsync).not.toHaveBeenCalled();
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.state?.checking).toBe(false));
  expect(previewIntakeReview).toHaveBeenLastCalledWith(incoming, undefined, [], expect.any(AbortSignal), {
    quantity: "incoming",
  });
  expect(result.current.state?.needsRefresh).toBe(false);
  expect(result.current.state?.result?.items[0].confirmationToken).toBe("retried-choice-token");
  await act(() => result.current.confirm(original.id));
  expect(save.mutateAsync).toHaveBeenCalledWith(
    expect.objectContaining({
      recognitionMerge: {
        reviewVersion: 2,
        incoming,
        confirmationToken: "retried-choice-token",
        resolutions: { quantity: "incoming" },
      },
    }),
  );
});

it("aborts an earlier field review and ignores its late result when the same choice is changed", async () => {
  const first = deferred<IntakeReviewPreview>();
  const second = deferred<IntakeReviewPreview>();
  vi.mocked(previewIntakeReview)
    .mockResolvedValueOnce(resolvablePreview())
    .mockReturnValueOnce(first.promise)
    .mockReturnValueOnce(second.promise);
  const { result } = setup();
  await act(() => result.current.preview(incoming));
  let firstPending!: Promise<void>;
  let secondPending!: Promise<void>;
  act(() => {
    firstPending = result.current.resolveField(original.id, "quantity", "incoming")!;
    secondPending = result.current.resolveField(original.id, "quantity", "saved")!;
  });
  expect(vi.mocked(previewIntakeReview).mock.calls[1][3]?.aborted).toBe(true);
  expect(vi.mocked(previewIntakeReview).mock.calls[2][3]?.aborted).toBe(false);
  expect(result.current.state?.resolutions).toEqual({ quantity: "saved" });
  const obsolete = resolvablePreview();
  obsolete.items[0].confirmationToken = "obsolete-choice";
  await act(async () => {
    first.resolve(obsolete);
    await firstPending;
  });
  expect(result.current.state?.checking).toBe(true);
  expect(result.current.state?.result?.items[0].confirmationToken).not.toBe("obsolete-choice");
  const latest = resolvablePreview();
  latest.items[0].confirmationToken = "latest-choice";
  await act(async () => {
    second.resolve(latest);
    await secondPending;
  });
  expect(result.current.state?.checking).toBe(false);
  expect(result.current.state?.result?.items[0].confirmationToken).toBe("latest-choice");
});

it("cancels a field recheck on a new draft revision and does not allow unlisted or unrelated field choices", async () => {
  const read = deferred<IntakeReviewPreview>();
  vi.mocked(previewIntakeReview).mockResolvedValueOnce(resolvablePreview()).mockReturnValueOnce(read.promise);
  const { result, revision, rerender, save } = setup();
  await act(() => result.current.preview(incoming));
  act(() => {
    void result.current.resolveField(original.id, "iacuc", "incoming");
    void result.current.resolveField("unrelated", "quantity", "incoming");
  });
  expect(previewIntakeReview).toHaveBeenCalledOnce();
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.resolveField(original.id, "quantity", "incoming")!;
  });
  revision.current += 1;
  rerender();
  expect(vi.mocked(previewIntakeReview).mock.calls[1][3]?.aborted).toBe(true);
  expect(result.current.state).toBeNull();
  await act(async () => {
    read.resolve(resolvablePreview());
    await pending;
  });
  await act(() => result.current.confirm(original.id));
  expect(save.mutateAsync).not.toHaveBeenCalled();
});
