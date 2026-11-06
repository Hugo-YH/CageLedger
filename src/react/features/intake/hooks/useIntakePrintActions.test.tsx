import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type {
  IntakeBatch,
  IntakePrintBatch,
  IntakeSaveRequest,
  IntakeWriteResponse,
} from "../../../../contracts/intake";
import type * as IntakeApi from "../../../api/intake";
import type * as IntakeCards from "../../../print/intakeCards";
import { createIntakeDraft } from "../../../../domain/intake";
import { openIntakeCardPrint } from "../../../print/intakeCards";
import { fetchIntakeBatchesForPrint } from "../../../api/intake";
import { openIntakePrintWindow } from "../intakePrintWindow";
import { prepareIntakePrintContacts } from "../intakePrintContacts";
import type { IntakeSaveIntent, PendingIntakePrintJob } from "../intakeViewTypes";
import type { useIntakeEditor } from "./useIntakeEditor";
import { useIntakeSaveFlow } from "./useIntakeSaveFlow";
import { useIntakePrintActions } from "./useIntakePrintActions";

const mutate = vi.hoisted(() => vi.fn<(request: IntakeSaveRequest) => Promise<IntakeWriteResponse>>());
const warning = vi.hoisted(() => vi.fn());
vi.mock("../intakePrintContacts", () => ({ prepareIntakePrintContacts: vi.fn() }));
vi.mock("../../../api/intake", async (original) => ({
  ...(await original<typeof IntakeApi>()),
  useSaveIntakeBatch: () => ({ mutateAsync: mutate, isPending: false }),
  fetchIntakeBatchesForPrint: vi.fn(),
}));
vi.mock("../../../print/intakeCards", async (original) => ({
  ...(await original<typeof IntakeCards>()),
  openIntakeCardPrint: vi.fn(),
}));
vi.mock("../intakePrintWindow", () => ({ openIntakePrintWindow: vi.fn() }));
vi.mock("../../../hooks/useOperationFeedback", () => ({
  useOperationFeedback: () => ({ warning, message: { info: vi.fn() } }),
}));
const draft = {
  ...createIntakeDraft("录入人"),
  batchNo: "B1",
  roomName: "8014",
  intakeDate: "2026-11-03",
  quantity: 14,
  finalCardCount: 14,
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((yes) => {
    resolve = yes;
  });
  return { promise, resolve };
}
function setup() {
  const revision = { current: 1 };
  const close = vi.fn();
  const popup = { close } as unknown as Window;
  vi.mocked(openIntakePrintWindow).mockReturnValue(popup);
  const adopt = vi.fn((item) => item);
  const markPrinted = vi.fn(async () => {});
  const bulkNotice = vi.fn();
  const editor = {
    draft,
    editing: false,
    revision,
    recognition: { reading: false },
    requireRooms: () => true,
    setNotice: vi.fn(),
    adoptPrintedDraft: adopt,
  } as unknown as ReturnType<typeof useIntakeEditor>;
  const isCurrent = (intent: IntakeSaveIntent) => intent.draftRevision === revision.current;
  const hook = renderHook(() => {
    const saves = useIntakeSaveFlow({
      mode: "entry",
      revision,
      snapshotImages: () => [{ name: "图.png", dataUrl: "original" }],
      isCurrent,
      onError: editor.setNotice,
      invalidate: () => {
        revision.current += 1;
      },
      onSaved,
    });
    const printer = useIntakePrintActions({
      editor,
      saves,
      roomNames: ["8014"],
      printRooms: [{ name: "8014", facility: "zhujiang" }],
      markPrinted,
      showBulkNotice: bulkNotice,
    });
    function onSaved(intent: IntakeSaveIntent, item: IntakeBatch, target: Window | null): Promise<void> {
      return printer.completeSavedPrint(intent, item, target);
    }
    return printer;
  });
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
  return { ...hook, revision, popup, close, adopt, markPrinted, bulkNotice, job };
}
beforeEach(() => {
  warning.mockReset();
  vi.mocked(prepareIntakePrintContacts).mockReset().mockResolvedValue({ contactPhones: {}, warning: "" });
  mutate.mockReset();
  vi.mocked(fetchIntakeBatchesForPrint).mockReset();
  vi.mocked(openIntakeCardPrint).mockReset().mockReturnValue(true);
  vi.mocked(openIntakePrintWindow).mockReset();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

it("opens immediately, then saves before adopting the returned draft, printing and marking", async () => {
  const pending = deferred<IntakeWriteResponse>();
  mutate.mockReturnValue(pending.promise);
  const { result, popup, adopt, markPrinted, job } = setup();
  let printing!: Promise<void>;
  act(() => {
    printing = result.current.executePrint(job, true);
  });
  expect(openIntakePrintWindow).toHaveBeenCalledTimes(1);
  expect(mutate).toHaveBeenCalledTimes(1);
  expect(openIntakeCardPrint).not.toHaveBeenCalled();
  const saved = { ...draft, updatedAt: "server-version" };
  await act(async () => {
    pending.resolve({ item: saved });
    await printing;
  });
  expect(adopt).toHaveBeenCalledExactlyOnceWith(saved);
  expect(openIntakeCardPrint).toHaveBeenCalledExactlyOnceWith([saved], {
    kind: "standard",
    fillBlanks: true,
    targetWindow: popup,
    contactPhones: {},
  });
  expect(markPrinted).toHaveBeenCalledExactlyOnceWith([saved]);
});

it("uses print-only phone context without changing the saved batch, including warning while still printing", async () => {
  const context = { contactPhones: { [draft.id]: "13800000001" }, warning: "另一位助手电话待核对" };
  vi.mocked(prepareIntakePrintContacts).mockResolvedValue(context);
  vi.mocked(fetchIntakeBatchesForPrint).mockResolvedValue([draft]);
  const { result, popup, job, markPrinted } = setup();
  await act(() => result.current.executePrint({ ...job, saveCurrent: false }, false));
  expect(prepareIntakePrintContacts).toHaveBeenCalledExactlyOnceWith([draft], expect.any(AbortSignal));
  expect(openIntakeCardPrint).toHaveBeenCalledExactlyOnceWith([draft], {
    kind: "standard",
    fillBlanks: false,
    targetWindow: popup,
    contactPhones: context.contactPhones,
  });
  expect(warning).toHaveBeenCalledExactlyOnceWith("请核对笼卡联系电话", context.warning);
  expect(markPrinted).toHaveBeenCalledExactlyOnceWith([draft]);
});

it("does not block printing or fall back to the receiver's phone if contact lookup fails", async () => {
  vi.mocked(prepareIntakePrintContacts).mockRejectedValue(new Error("directory unavailable"));
  vi.mocked(fetchIntakeBatchesForPrint).mockResolvedValue([draft]);
  const { result, popup, job, markPrinted } = setup();
  await act(() => result.current.executePrint({ ...job, saveCurrent: false }, false));
  expect(openIntakeCardPrint).toHaveBeenCalledExactlyOnceWith([draft], {
    kind: "standard",
    fillBlanks: false,
    targetWindow: popup,
    contactPhones: undefined,
  });
  expect(warning).toHaveBeenCalledWith("笼卡联系电话读取失败", expect.any(String));
  expect(markPrinted).toHaveBeenCalledTimes(1);
});

it("keeps temporary-room printing independent of the contacts directory", async () => {
  vi.mocked(fetchIntakeBatchesForPrint).mockResolvedValue([draft]);
  const { result, job, markPrinted } = setup();
  await act(() => result.current.executePrint({ ...job, kind: "temporary", saveCurrent: false }, false));
  expect(prepareIntakePrintContacts).not.toHaveBeenCalled();
  expect(warning).not.toHaveBeenCalled();
  expect(markPrinted).toHaveBeenCalledTimes(1);
});

it("does not look up phone numbers for selected direct-sampling batches that have no printed card", async () => {
  const direct = { ...draft, id: "direct", intakePurpose: "direct_sampling" as const };
  vi.mocked(fetchIntakeBatchesForPrint).mockResolvedValue([draft, direct]);
  const { result, job } = setup();
  await act(() => result.current.executePrint({ ...job, saveCurrent: false }, false));
  expect(prepareIntakePrintContacts).toHaveBeenCalledExactlyOnceWith([draft], expect.any(AbortSignal));
});

it("closes a retired draft's popup without clearing the new editor or marking it printed", async () => {
  const pending = deferred<IntakeWriteResponse>();
  mutate.mockReturnValue(pending.promise);
  const { result, close, revision, adopt, markPrinted, job } = setup();
  let printing!: Promise<void>;
  act(() => {
    printing = result.current.executePrint(job, false);
  });
  revision.current += 1;
  await act(async () => {
    pending.resolve({ item: draft });
    await printing;
  });
  expect(close).toHaveBeenCalledTimes(1);
  expect(adopt).not.toHaveBeenCalled();
  expect(openIntakeCardPrint).not.toHaveBeenCalled();
  expect(markPrinted).not.toHaveBeenCalled();
});

it("fetches selected saved batches by their captured versions and keeps a failed list print separate from saving", async () => {
  vi.mocked(fetchIntakeBatchesForPrint).mockRejectedValue(new Error("所选批次已更新"));
  const { result, close, job, bulkNotice, markPrinted } = setup();
  await act(() => result.current.executePrint({ ...job, draft: undefined, saveCurrent: false }, false));
  expect(fetchIntakeBatchesForPrint).toHaveBeenCalledExactlyOnceWith(job.batches, expect.any(AbortSignal));
  expect(mutate).not.toHaveBeenCalled();
  expect(markPrinted).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
  expect(bulkNotice).toHaveBeenCalledExactlyOnceWith("所选批次已更新", "error");
});

it("owns one list print from the click through data, contacts and the completed print-record write", async () => {
  const data = deferred<IntakePrintBatch[]>();
  const contacts = deferred<Awaited<ReturnType<typeof prepareIntakePrintContacts>>>();
  const write = deferred<void>();
  vi.mocked(fetchIntakeBatchesForPrint).mockReturnValueOnce(data.promise);
  vi.mocked(prepareIntakePrintContacts).mockReturnValueOnce(contacts.promise);
  const { result, job, markPrinted } = setup();
  markPrinted.mockReturnValueOnce(write.promise);
  let printing!: Promise<void>;
  act(() => {
    printing = result.current.executePrint({ ...job, saveCurrent: false }, false);
    void result.current.executePrint({ ...job, saveCurrent: false }, false);
    result.current.requestPrint(job.batches);
  });
  expect(result.current.preparing).toBe(true);
  expect(openIntakePrintWindow).toHaveBeenCalledOnce();
  expect(fetchIntakeBatchesForPrint).toHaveBeenCalledOnce();
  const signal = vi.mocked(fetchIntakeBatchesForPrint).mock.calls[0][1];
  await act(async () => {
    data.resolve([draft]);
    await data.promise;
  });
  expect(prepareIntakePrintContacts).toHaveBeenCalledExactlyOnceWith([draft], signal);
  expect(result.current.preparing).toBe(true);
  await act(async () => {
    contacts.resolve({ contactPhones: {}, warning: "" });
    await contacts.promise;
  });
  expect(openIntakeCardPrint).toHaveBeenCalledOnce();
  expect(markPrinted).toHaveBeenCalledOnce();
  expect(result.current.preparing).toBe(false);
  await act(() => result.current.executePrint({ ...job, saveCurrent: false }, false));
  expect(openIntakePrintWindow).toHaveBeenCalledOnce();
  await act(async () => {
    write.resolve();
    await printing;
  });
});

it("cancels a closed preparation window and an old completion cannot retire the next print", async () => {
  vi.useFakeTimers();
  const old = deferred<IntakePrintBatch[]>();
  const next = deferred<IntakePrintBatch[]>();
  vi.mocked(fetchIntakeBatchesForPrint).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise);
  const { result, job, popup, markPrinted, bulkNotice } = setup();
  let printing!: Promise<void>;
  act(() => {
    printing = result.current.executePrint({ ...job, saveCurrent: false }, false);
  });
  const oldSignal = vi.mocked(fetchIntakeBatchesForPrint).mock.calls[0][1];
  Object.defineProperty(popup, "closed", { configurable: true, value: true });
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(oldSignal?.aborted).toBe(true);
  expect(result.current.preparing).toBe(false);
  const nextPopup = { close: vi.fn(), closed: false } as unknown as Window;
  vi.mocked(openIntakePrintWindow).mockReturnValueOnce(nextPopup);
  let nextPrinting!: Promise<void>;
  act(() => {
    nextPrinting = result.current.executePrint({ ...job, saveCurrent: false }, false);
  });
  await act(async () => {
    old.resolve([draft]);
    await printing;
  });
  expect(result.current.preparing).toBe(true);
  expect(openIntakeCardPrint).not.toHaveBeenCalled();
  expect(bulkNotice).not.toHaveBeenCalled();
  await act(async () => {
    next.resolve([draft]);
    await nextPrinting;
  });
  expect(openIntakeCardPrint).toHaveBeenCalledOnce();
  expect(markPrinted).toHaveBeenCalledOnce();
});

it("aborts contact preparation on unmount without warning, rendering or recording a print", async () => {
  const contacts = deferred<Awaited<ReturnType<typeof prepareIntakePrintContacts>>>();
  vi.mocked(fetchIntakeBatchesForPrint).mockResolvedValueOnce([draft]);
  vi.mocked(prepareIntakePrintContacts).mockReturnValueOnce(contacts.promise);
  const { result, unmount, job, close, markPrinted, bulkNotice } = setup();
  let printing!: Promise<void>;
  await act(() => {
    printing = result.current.executePrint({ ...job, saveCurrent: false }, false);
    return Promise.resolve();
  });
  const signal = vi.mocked(prepareIntakePrintContacts).mock.calls[0][1];
  unmount();
  expect(signal?.aborted).toBe(true);
  expect(close).toHaveBeenCalled();
  await act(async () => {
    contacts.resolve({ contactPhones: {}, warning: "late warning" });
    await printing;
  });
  expect(warning).not.toHaveBeenCalled();
  expect(openIntakeCardPrint).not.toHaveBeenCalled();
  expect(markPrinted).not.toHaveBeenCalled();
  expect(bulkNotice).not.toHaveBeenCalled();
});

it("lets a started save finish after unmount without printing its retired draft", async () => {
  const write = deferred<IntakeWriteResponse>();
  mutate.mockReturnValueOnce(write.promise);
  const { result, unmount, job, adopt, markPrinted } = setup();
  let printing!: Promise<void>;
  act(() => {
    printing = result.current.executePrint(job, false);
  });
  expect(mutate).toHaveBeenCalledOnce();
  unmount();
  await act(async () => {
    write.resolve({ item: draft });
    await printing;
  });
  expect(mutate).toHaveBeenCalledOnce();
  expect(adopt).not.toHaveBeenCalled();
  expect(openIntakeCardPrint).not.toHaveBeenCalled();
  expect(markPrinted).not.toHaveBeenCalled();
});

it("keeps a rendered window and lets a started print-record write finish after unmount", async () => {
  const write = deferred<void>();
  vi.mocked(fetchIntakeBatchesForPrint).mockResolvedValueOnce([draft]);
  const { result, unmount, job, close, markPrinted } = setup();
  markPrinted.mockReturnValueOnce(write.promise);
  let printing!: Promise<void>;
  await act(() => {
    printing = result.current.executePrint({ ...job, saveCurrent: false }, false);
    return Promise.resolve();
  });
  expect(markPrinted).toHaveBeenCalledOnce();
  expect(openIntakeCardPrint).toHaveBeenCalledOnce();
  unmount();
  expect(close).not.toHaveBeenCalled();
  await act(async () => {
    write.resolve();
    await printing;
  });
  expect(markPrinted).toHaveBeenCalledOnce();
});

it("holds the write lock after a rendered window closes without continuing its polling", async () => {
  vi.useFakeTimers();
  const write = deferred<void>();
  vi.mocked(fetchIntakeBatchesForPrint).mockResolvedValueOnce([draft]);
  const { result, job, popup, markPrinted } = setup();
  markPrinted.mockReturnValueOnce(write.promise);
  let printing!: Promise<void>;
  await act(() => {
    printing = result.current.executePrint({ ...job, saveCurrent: false }, false);
    return Promise.resolve();
  });
  expect(markPrinted).toHaveBeenCalledOnce();
  Object.defineProperty(popup, "closed", { configurable: true, value: true });
  await act(() => vi.advanceTimersByTimeAsync(200));
  expect(vi.getTimerCount()).toBe(0);
  await act(() => result.current.executePrint({ ...job, saveCurrent: false }, false));
  expect(openIntakePrintWindow).toHaveBeenCalledOnce();
  await act(async () => {
    write.resolve();
    await printing;
  });
  expect(markPrinted).toHaveBeenCalledOnce();
});

it("owns the resumed popup after a duplicate-confirmation save completes outside the initial print call", async () => {
  const { result, job, popup, adopt, markPrinted } = setup();
  const saved = { ...draft, updatedAt: "confirmed-write" };
  const intent: IntakeSaveIntent = {
    item: draft,
    exists: false,
    mode: "entry",
    draftRevision: 1,
    recognitionImages: [],
    print: { job, fillBlanks: true },
  };
  await act(() => result.current.completeSavedPrint(intent, saved, popup));
  expect(adopt).toHaveBeenCalledExactlyOnceWith(saved);
  expect(openIntakePrintWindow).not.toHaveBeenCalled();
  expect(openIntakeCardPrint).toHaveBeenCalledExactlyOnceWith([saved], {
    kind: "standard",
    fillBlanks: true,
    targetWindow: popup,
    contactPhones: {},
  });
  expect(markPrinted).toHaveBeenCalledExactlyOnceWith([saved]);
  expect(result.current.preparing).toBe(false);
});
