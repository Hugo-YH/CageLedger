import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IntakeSaveRequest, IntakeWriteResponse } from "../../../../contracts/intake";
import type * as IntakeApi from "../../../api/intake";
import { createIntakeDraft } from "../../../../domain/intake";
import { ApiError } from "../../../api/client";
import { openIntakePrintWindow } from "../intakePrintWindow";
import type { PendingIntakePrintJob } from "../intakeViewTypes";
import { useIntakeSaveFlow } from "./useIntakeSaveFlow";

const mutate = vi.hoisted(() => vi.fn<(request: IntakeSaveRequest) => Promise<IntakeWriteResponse>>());
vi.mock("../../../api/intake", async (original) => ({
  ...(await original<typeof IntakeApi>()),
  useSaveIntakeBatch: () => ({ mutateAsync: mutate, isPending: false }),
}));
vi.mock("../intakePrintWindow", () => ({ openIntakePrintWindow: vi.fn() }));
const draft = { ...createIntakeDraft("录入人"), batchNo: "B1", updatedAt: "version-1" };
const images = [{ name: "原图.png", dataUrl: "data:image/png;base64,original" }];
function duplicate(token = "token-1") {
  return new ApiError("请确认重复记录", 409, {
    code: "INTAKE_DUPLICATE_CONFIRMATION_REQUIRED",
    details: { items: [], total: 1, confirmationToken: token },
  });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function setup() {
  const revision = { current: 1 };
  const onSaved = vi.fn();
  const onError = vi.fn();
  const snapshot = vi.fn(() => images.map((item) => ({ ...item })));
  const isCurrent = (intent: { draftRevision: number }) => intent.draftRevision === revision.current;
  return {
    ...renderHook(() =>
      useIntakeSaveFlow({
        mode: "entry",
        revision,
        snapshotImages: snapshot,
        isCurrent,
        onSaved,
        onError,
        invalidate: () => {
          revision.current += 1;
        },
      }),
    ),
    revision,
    onSaved,
    onError,
    snapshot,
  };
}
beforeEach(() => {
  mutate.mockReset();
  vi.mocked(openIntakePrintWindow).mockReset();
});
afterEach(cleanup);

it("captures images once and uses the same draft and images when the duplicate is confirmed", async () => {
  mutate.mockRejectedValueOnce(duplicate()).mockResolvedValueOnce({ item: draft });
  const { result, snapshot, onSaved } = setup();
  const intent = result.current.capture(draft, true);
  await act(() => result.current.run(intent));
  expect(result.current.pendingDuplicate?.intent).toBe(intent);
  snapshot.mockReturnValue([{ name: "其他图片.png", dataUrl: "new-image" }]);
  await act(() => result.current.confirmDuplicate());
  expect(mutate).toHaveBeenNthCalledWith(2, {
    item: draft,
    exists: true,
    checkDuplicates: true,
    reviewVersion: 2,
    recognitionImages: images,
    duplicateConfirmation: "token-1",
  });
  expect(snapshot).toHaveBeenCalledTimes(1);
  expect(onSaved).toHaveBeenCalledExactlyOnceWith(intent, draft, null);
  expect(result.current.pendingDuplicate).toBeNull();
});

it("keeps a changed duplicate token and a plain failure in the existing confirmation dialog", async () => {
  mutate
    .mockRejectedValueOnce(duplicate())
    .mockRejectedValueOnce(duplicate("token-2"))
    .mockRejectedValueOnce(new Error("暂时失败"));
  const { result, onError } = setup();
  await act(() => result.current.run(result.current.capture(draft, false)));
  await act(() => result.current.confirmDuplicate());
  expect(result.current.pendingDuplicate).toMatchObject({
    details: { confirmationToken: "token-2" },
    error: "重复记录已更新，请重新核对后确认保存。",
  });
  await act(() => result.current.confirmDuplicate());
  expect(mutate.mock.calls[2][0].duplicateConfirmation).toBe("token-2");
  expect(result.current.pendingDuplicate?.error).toBe("暂时失败");
  expect(onError).not.toHaveBeenCalled();
});

it("invalidates duplicate confirmation when the draft revision changes or the dialog is dismissed", async () => {
  mutate.mockRejectedValueOnce(duplicate());
  const { result, revision, rerender } = setup();
  await act(() => result.current.run(result.current.capture(draft, false)));
  revision.current += 1;
  rerender();
  expect(result.current.pendingDuplicate).toBeNull();
  await act(() => result.current.confirmDuplicate());
  expect(mutate).toHaveBeenCalledTimes(1);
  mutate.mockRejectedValueOnce(duplicate());
  await act(() => result.current.run(result.current.capture(draft, false)));
  act(() => result.current.dismissDuplicate());
  expect(result.current.pendingDuplicate).toBeNull();
  expect(revision.current).toBe(3);
});

it("prevents duplicate writes and ignores a late success for a retired draft", async () => {
  const pending = deferred<IntakeWriteResponse>();
  mutate.mockReturnValue(pending.promise);
  const { result, revision, onSaved } = setup();
  const intent = result.current.capture(draft, false);
  const close = vi.fn();
  const popup = { close } as unknown as Window;
  let saving!: Promise<void>;
  act(() => {
    saving = result.current.run(intent, popup);
    void result.current.run(intent);
  });
  expect(mutate).toHaveBeenCalledTimes(1);
  revision.current += 1;
  await act(async () => {
    pending.resolve({ item: draft });
    await saving;
  });
  expect(onSaved).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
  expect(result.current.inFlight.current).toBe(false);
});

it("opens the print popup in the duplicate-confirmation click before writing and preserves the print continuation", async () => {
  const order: string[] = [];
  const close = vi.fn();
  const popup = { close } as unknown as Window;
  vi.mocked(openIntakePrintWindow).mockImplementation(() => {
    order.push("open");
    return popup;
  });
  mutate.mockRejectedValueOnce(duplicate()).mockImplementationOnce(() => {
    order.push("write");
    return Promise.resolve({ item: draft });
  });
  const { result, onSaved } = setup();
  const job: PendingIntakePrintJob = {
    batches: [draft],
    draft,
    kind: "standard",
    cardCount: 14,
    pageSize: 14,
    missing: 0,
    saveCurrent: true,
    exists: false,
    draftRevision: 1,
  };
  const intent = result.current.capture(draft, false, { job, fillBlanks: true });
  await act(() => result.current.run(intent));
  await act(() => result.current.confirmDuplicate());
  expect(order).toEqual(["open", "write"]);
  expect(onSaved).toHaveBeenCalledExactlyOnceWith(intent, draft, popup);
});

it("does not write or discard duplicate confirmation when the browser blocks the print popup", async () => {
  mutate.mockRejectedValueOnce(duplicate());
  vi.mocked(openIntakePrintWindow).mockReturnValue(null);
  const { result } = setup();
  const job: PendingIntakePrintJob = {
    batches: [draft],
    draft,
    kind: "standard",
    cardCount: 14,
    pageSize: 14,
    missing: 0,
    saveCurrent: true,
    exists: false,
    draftRevision: 1,
  };
  await act(() => result.current.run(result.current.capture(draft, false, { job, fillBlanks: false })));
  await act(() => result.current.confirmDuplicate());
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(result.current.pendingDuplicate?.error).toContain("打印窗口被浏览器拦截");
});
