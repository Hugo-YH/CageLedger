import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { IntakeBatch, IntakeSaveRequest, IntakeWriteResponse } from "../../../../contracts/intake";
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
});
afterEach(cleanup);

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
  expect(prepareIntakePrintContacts).toHaveBeenCalledExactlyOnceWith([draft]);
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
  expect(prepareIntakePrintContacts).toHaveBeenCalledExactlyOnceWith([draft]);
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
  expect(fetchIntakeBatchesForPrint).toHaveBeenCalledExactlyOnceWith(job.batches);
  expect(mutate).not.toHaveBeenCalled();
  expect(markPrinted).not.toHaveBeenCalled();
  expect(close).toHaveBeenCalledTimes(1);
  expect(bulkNotice).toHaveBeenCalledExactlyOnceWith("所选批次已更新", "error");
});
