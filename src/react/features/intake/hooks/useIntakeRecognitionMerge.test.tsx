import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { IntakeRecognitionMergePreview, IntakeWriteResponse } from "../../../../contracts/intake";
import { createIntakeDraft } from "../../../../domain/intake";
import { previewIntakeRecognitionMerge } from "../../../api/intake";
import { ApiError } from "../../../api/client";
import { useIntakeRecognitionMerge } from "./useIntakeRecognitionMerge";

vi.mock("../../../api/intake", () => ({ previewIntakeRecognitionMerge: vi.fn() }));
const incoming = { ...createIntakeDraft("录入人"), rawMessage: "待补充文字", batchNo: "B1", intakeDate: "2026-11-03" };
const original = { ...createIntakeDraft("图片录入人"), id: "saved-image", updatedAt: "v1", quantity: 30 };
const merged = { ...original, intakeDate: incoming.intakeDate };
function previewResult(): IntakeRecognitionMergePreview {
  return {
    total: 1,
    items: [
      {
        item: original,
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
function setup() {
  const revision = { current: 1 };
  const saveInFlight = { current: false };
  const save = { mutateAsync: vi.fn<(request: unknown) => Promise<IntakeWriteResponse>>() };
  const onSaved = vi.fn();
  const hook = renderHook(() => useIntakeRecognitionMerge({ revision, save, saveInFlight, onSaved }));
  return { ...hook, revision, saveInFlight, save, onSaved };
}
beforeEach(() => vi.mocked(previewIntakeRecognitionMerge).mockReset());
afterEach(cleanup);

it("only previews the recognized draft, excludes an edited ID and does not write before confirmation", async () => {
  vi.mocked(previewIntakeRecognitionMerge).mockResolvedValue(previewResult());
  const { result, save } = setup();
  await act(() => result.current.preview(incoming, "current-editor"));
  expect(previewIntakeRecognitionMerge).toHaveBeenCalledExactlyOnceWith(incoming, "current-editor");
  expect(result.current.state?.incoming).toEqual(incoming);
  expect(save.mutateAsync).not.toHaveBeenCalled();
  act(() => result.current.close());
  expect(result.current.state).toBeNull();
  expect(incoming.rawMessage).toBe("待补充文字");
});

it("retains recognized text after a preview failure and retries the same draft", async () => {
  vi.mocked(previewIntakeRecognitionMerge)
    .mockRejectedValueOnce(new Error("匹配暂不可用"))
    .mockResolvedValueOnce(previewResult());
  const { result, save } = setup();
  await act(() => result.current.preview(incoming));
  expect(result.current.state).toMatchObject({ incoming, checking: false, error: "匹配暂不可用" });
  act(() => result.current.retry());
  await waitFor(() => expect(result.current.state?.checking).toBe(false));
  expect(result.current.state?.result?.total).toBe(1);
  expect(previewIntakeRecognitionMerge).toHaveBeenCalledTimes(2);
  expect(save.mutateAsync).not.toHaveBeenCalled();
});

it("leaves an unmatched recognized draft on the normal save path without an error or automatic write", async () => {
  vi.mocked(previewIntakeRecognitionMerge).mockResolvedValue({ items: [], total: 0 });
  const { result, save } = setup();
  await act(() => result.current.preview(incoming));
  expect(result.current.state).toMatchObject({ incoming, checking: false, error: "", result: { items: [], total: 0 } });
  await act(() => result.current.confirm());
  expect(save.mutateAsync).not.toHaveBeenCalled();
});

it("updates the server-provided original exactly once, keeps text after save failure and can retry", async () => {
  vi.mocked(previewIntakeRecognitionMerge).mockResolvedValue(previewResult());
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
    recognitionMerge: { incoming, confirmationToken: "preview-token" },
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
  expect(onSaved).toHaveBeenCalledExactlyOnceWith({ ...merged, updatedAt: "v2" });
  expect(result.current.state).toBeNull();
});

it.each(["multiple", "blocked", "missing-token"])("never confirms an ineligible preview (%s)", async (kind) => {
  const response = previewResult();
  if (kind === "multiple") response.total = 2;
  if (kind === "blocked") response.items[0].canMerge = false;
  if (kind === "missing-token") response.items[0].confirmationToken = "";
  vi.mocked(previewIntakeRecognitionMerge).mockResolvedValue(response);
  const { result, save } = setup();
  await act(() => result.current.preview(incoming));
  await act(() => result.current.confirm());
  expect(save.mutateAsync).not.toHaveBeenCalled();
});

it("requires a fresh preview after a 409 instead of replaying a stale merge token", async () => {
  const refreshed = previewResult();
  refreshed.items[0].confirmationToken = "refreshed-token";
  vi.mocked(previewIntakeRecognitionMerge).mockResolvedValueOnce(previewResult()).mockResolvedValueOnce(refreshed);
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
    expect.objectContaining({ recognitionMerge: { incoming, confirmationToken: "refreshed-token" } }),
  );
});

it("ignores late previews after a new draft revision and after unmount", async () => {
  const read = deferred<IntakeRecognitionMergePreview>();
  vi.mocked(previewIntakeRecognitionMerge).mockReturnValue(read.promise);
  const { result, revision, rerender, unmount, save } = setup();
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.preview(incoming);
  });
  revision.current += 1;
  rerender();
  expect(result.current.state).toBeNull();
  unmount();
  await act(async () => {
    read.resolve(previewResult());
    await pending;
  });
  expect(save.mutateAsync).not.toHaveBeenCalled();
});

it("does not reset a newer draft when an earlier merge write finishes", async () => {
  vi.mocked(previewIntakeRecognitionMerge).mockResolvedValue(previewResult());
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

it("skips matching when neither identifier was recognized", async () => {
  const { result } = setup();
  await act(() => result.current.preview({ ...incoming, batchNo: "", purchaseOrderNo: "" }));
  expect(previewIntakeRecognitionMerge).not.toHaveBeenCalled();
  expect(result.current.state).toBeNull();
});
