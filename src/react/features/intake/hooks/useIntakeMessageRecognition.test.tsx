import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { IntakeAiParseResponse, IntakeBatch } from "../../../../contracts/intake";
import type { SessionUser } from "../../../../contracts/session";
import { createIntakeDraft, parseIntakeMessage } from "../../../../domain/intake";
import type * as IntakeDomain from "../../../../domain/intake";
import { aiParseIntakeMessage, standardizeIntakeStrain } from "../../../api/intake";
import { useIntakeMessageRecognition } from "./useIntakeMessageRecognition";
import type { useIntakeRecognition } from "./useIntakeRecognition";

vi.mock("../../../api/intake", () => ({ aiParseIntakeMessage: vi.fn(), standardizeIntakeStrain: vi.fn() }));
vi.mock("../../../../domain/intake", async (load) => ({
  ...(await load<typeof IntakeDomain>()),
  parseIntakeMessage: vi.fn(),
}));
const feedback = vi.hoisted(() => ({ info: vi.fn(), warning: vi.fn() }));
vi.mock("../../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => feedback }));
const user = { id: "admin", role: "admin", displayName: "录入人", phone: "13800000000" } as SessionUser;
let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  vi.mocked(parseIntakeMessage).mockReturnValue({
    ...createIntakeDraft("录入人"),
    batchNo: "B-1",
    purchaseOrderNo: "P-1",
    intakeDate: "2026-11-03",
  });
  vi.mocked(aiParseIntakeMessage).mockResolvedValue({ item: { batchNo: "B-1", purchaseOrderNo: "P-1", quantity: 30 } });
});
afterEach(() => {
  cleanup();
  client.clear();
});
function setup(mode: "entry" | "batches" = "entry", editing = false) {
  const revision = { current: 1 };
  const draft = { ...createIntakeDraft("旧接收人"), id: "current-draft", rawMessage: "预约原文" };
  const request = { signal: new AbortController().signal, isCurrent: () => true, finish: vi.fn() };
  const recognition: ReturnType<typeof useIntakeRecognition> = {
    images: [],
    error: "",
    pending: false,
    reading: false,
    invalidate: vi.fn(),
    reset: vi.fn(),
    addFiles: vi.fn(),
    remove: vi.fn(),
    begin: vi.fn(() => request),
    snapshot: vi.fn(() => []),
  };
  const replaceDraft = vi.fn<(item: IntakeBatch) => void>(() => {
    revision.current += 1;
  });
  const onTextRecognized = vi.fn<(_item: IntakeBatch, _id?: string) => Promise<void>>().mockResolvedValue();
  const setNotice = vi.fn();
  const hook = renderHook(
    () =>
      useIntakeMessageRecognition({
        draft,
        user,
        mode,
        editing,
        roomNames: ["8014"],
        revision,
        recognition,
        requireRooms: () => true,
        replaceDraft,
        setNotice,
        onTextRecognized,
      }),
    {
      wrapper: ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={client}>{children}</QueryClientProvider>
      ),
    },
  );
  return { ...hook, draft, revision, recognition, request, replaceDraft, onTextRecognized, setNotice };
}

it.each(["local", "ai"])("previews a text-only %s result after applying the recognized draft", async (kind) => {
  const { result, replaceDraft, onTextRecognized, request } = setup();
  await act(() => (kind === "local" ? result.current.parseMessage() : result.current.aiParseMessage()));
  expect(replaceDraft).toHaveBeenCalledOnce();
  const applied = replaceDraft.mock.calls[0][0];
  expect(applied).toMatchObject({
    batchNo: "B-1",
    purchaseOrderNo: "P-1",
    rawMessage: "预约原文",
    receiverName: "录入人",
  });
  expect(onTextRecognized).toHaveBeenCalledExactlyOnceWith(applied, undefined);
  if (kind === "ai") expect(request.finish).toHaveBeenCalledOnce();
});

it("preserves the explicit edited ID and excludes it from text matching", async () => {
  const { result, replaceDraft, onTextRecognized } = setup("batches", true);
  await act(() => result.current.aiParseMessage());
  expect(replaceDraft.mock.calls[0][0]).toMatchObject({ id: "current-draft", receiverName: "旧接收人" });
  expect(onTextRecognized).toHaveBeenCalledWith(expect.objectContaining({ id: "current-draft" }), "current-draft");
});

it.each(["C2026100925690，DC202611022948607"])(
  "preserves the edited draft and stops before parsing or IACUC lookup for conflicting %s",
  async (rawMessage) => {
    const { result, draft, replaceDraft, onTextRecognized, setNotice, revision } = setup("batches", true);
    Object.assign(draft, { rawMessage, purchaseOrderNo: "人工采购编号", orderNo: "人工订单编号", owner: "人工预约人" });
    const before = { ...draft };
    const lookup = vi.spyOn(client, "ensureQueryData");
    await act(() => result.current.parseMessage());
    expect(draft).toEqual(before);
    expect(revision.current).toBe(1);
    expect(replaceDraft).not.toHaveBeenCalled();
    expect(parseIntakeMessage).not.toHaveBeenCalled();
    expect(standardizeIntakeStrain).not.toHaveBeenCalled();
    expect(lookup).not.toHaveBeenCalled();
    expect(onTextRecognized).not.toHaveBeenCalled();
    expect(setNotice).not.toHaveBeenCalled();
    expect(feedback.warning).toHaveBeenCalledOnce();
    expect(feedback.info).not.toHaveBeenCalled();
  },
);

it.each(["local", "ai"])(
  "applies grouped %s identifiers without multiplying the appointment quantity",
  async (kind) => {
    const actual = await vi.importActual<typeof IntakeDomain>("../../../../domain/intake");
    const rawMessage =
      "订单编号：DC202609212926501、DC202609212923401\n饲养需求批次号：（Z2025034）2025090302、（Z2025034）2025090313\n数量：60只";
    const parsed = actual.parseIntakeMessage(rawMessage);
    vi.mocked(parseIntakeMessage).mockReturnValue(parsed);
    vi.mocked(aiParseIntakeMessage).mockResolvedValue({ item: parsed });
    const { result, draft, replaceDraft, onTextRecognized } = setup();
    draft.rawMessage = rawMessage;
    const lookup = vi
      .spyOn(client, "ensureQueryData")
      .mockResolvedValue({ items: [{ iacuc: "Z2025034", project: "项目" }] });
    await act(() => (kind === "local" ? result.current.parseMessage() : result.current.aiParseMessage()));
    expect(replaceDraft).toHaveBeenCalledOnce();
    const applied = replaceDraft.mock.calls[0][0];
    expect(applied).toMatchObject({
      quantity: 60,
      iacuc: "Z2025034",
      project: "项目",
      identifiers: {
        purchaseOrderNos: ["C2026092129265", "C2026092129234"],
        orderNos: ["DC202609212926501", "DC202609212923401"],
        batchNos: ["（Z2025034）2025090302", "（Z2025034）2025090313"],
      },
    });
    expect(lookup).toHaveBeenCalledOnce();
    expect(onTextRecognized).toHaveBeenCalledExactlyOnceWith(applied, undefined);
    expect(feedback.warning).not.toHaveBeenCalled();
    expect(feedback.info.mock.calls[0][1]).toContain("总数量只记录一次");
  },
);

it.each(["local", "ai"])(
  "preserves cross-IACUC %s drafts and asks for project review without arbitrary matching",
  async (kind) => {
    const actual = await vi.importActual<typeof IntakeDomain>("../../../../domain/intake");
    const parsed = actual.parseIntakeMessage(
      "饲养需求批次号：（Z2025034）2025090302、（Z2025035）2025090313\n数量：60只",
    );
    vi.mocked(parseIntakeMessage).mockReturnValue(parsed);
    vi.mocked(aiParseIntakeMessage).mockResolvedValue({
      item: { ...parsed, iacuc: "Z2025034", project: "不得自动采用" },
    });
    const { result, replaceDraft, onTextRecognized, setNotice } = setup();
    const lookup = vi.spyOn(client, "ensureQueryData");
    await act(() => (kind === "local" ? result.current.parseMessage() : result.current.aiParseMessage()));
    expect(replaceDraft.mock.calls[0][0]).toMatchObject({
      batchNo: "（Z2025034）2025090302、（Z2025035）2025090313",
      quantity: 60,
      iacuc: "",
      project: "",
    });
    expect(lookup).not.toHaveBeenCalled();
    expect(onTextRecognized).not.toHaveBeenCalled();
    expect(setNotice).toHaveBeenCalledWith(expect.stringContaining("按项目拆分预约"));
    expect(feedback.warning).toHaveBeenCalledOnce();
  },
);

it("does not let stale draft arrays overwrite a newly recognized single identifier", async () => {
  const { result, draft, replaceDraft } = setup();
  draft.identifiers = {
    purchaseOrderNos: ["C2026092129265", "C2026092129234"],
    orderNos: ["DC202609212926501", "DC202609212923401"],
    batchNos: ["（Z2025034）2025090302", "（Z2025034）2025090313"],
  };
  await act(() => result.current.aiParseMessage());
  const applied = replaceDraft.mock.calls[0][0];
  expect(applied).toMatchObject({ purchaseOrderNo: "P-1", orderNo: "", batchNo: "B-1" });
  expect(applied).not.toHaveProperty("identifiers");
});

it("keeps the current draft when recognition exceeds the grouped identifier limit", async () => {
  const identifiers = {
    purchaseOrderNos: Array.from({ length: 51 }, (_, index) => `manual-${index}`),
    orderNos: [],
    batchNos: [],
  };
  vi.mocked(aiParseIntakeMessage).mockResolvedValue({ item: { identifiers, quantity: 60 } });
  const { result, replaceDraft, onTextRecognized, setNotice } = setup();
  await act(() => result.current.aiParseMessage());
  expect(replaceDraft).not.toHaveBeenCalled();
  expect(onTextRecognized).not.toHaveBeenCalled();
  expect(setNotice).toHaveBeenCalledWith(expect.stringContaining("最多50个"));
});

it("continues local recognition for one consistent purchase and order pair", async () => {
  const { result, draft, replaceDraft, onTextRecognized } = setup();
  draft.rawMessage = "C2026110229486，DC202611022948607";
  await act(() => result.current.parseMessage());
  expect(parseIntakeMessage).toHaveBeenCalledExactlyOnceWith(draft.rawMessage, user.displayName, ["8014"]);
  expect(replaceDraft).toHaveBeenCalledOnce();
  expect(onTextRecognized).toHaveBeenCalledOnce();
  expect(feedback.warning).not.toHaveBeenCalled();
});

it("invalidates an earlier pending result when the operator rejects conflicting source identifiers", async () => {
  let finish!: (value: IntakeAiParseResponse) => void;
  vi.mocked(aiParseIntakeMessage).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result, draft, replaceDraft, onTextRecognized } = setup("batches", true);
  draft.rawMessage = "C2026100925690，DC202611022948607";
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.aiParseMessage();
  });
  await act(() => result.current.parseMessage());
  expect(feedback.warning).toHaveBeenCalledOnce();
  await act(async () => {
    finish({ item: { batchNo: "B-1", purchaseOrderNo: "C2026110229486" } });
    await pending;
  });
  expect(replaceDraft).not.toHaveBeenCalled();
  expect(onTextRecognized).not.toHaveBeenCalled();
});

it.each(["local", "ai"])("does not match text when new images accompany %s recognition", async (kind) => {
  const { result, recognition, onTextRecognized, replaceDraft } = setup();
  vi.mocked(recognition.snapshot).mockReturnValue([{ name: "新图片.png", dataUrl: "data:image/png;base64,eA==" }]);
  await act(() => (kind === "local" ? result.current.parseMessage() : result.current.aiParseMessage()));
  expect(replaceDraft).toHaveBeenCalledOnce();
  expect(onTextRecognized).not.toHaveBeenCalled();
});

it("does not start text matching while newly selected images are still being read", async () => {
  const { result, recognition, onTextRecognized } = setup();
  recognition.reading = true;
  await act(() => result.current.parseMessage());
  expect(onTextRecognized).not.toHaveBeenCalled();
});

it("preserves persisted original images in AI evidence while matching a later text-only recognition", async () => {
  const { result, draft, replaceDraft, onTextRecognized } = setup();
  const image = {
    id: "image-1",
    name: "原图.png",
    mime: "image/png",
    size: 10,
    sha256: "hash",
    url: "/original",
    createdAt: "now",
  };
  draft.recognition = { extractedText: "原图内容", warnings: [], fieldSources: {}, images: [image] };
  vi.mocked(aiParseIntakeMessage).mockResolvedValue({
    item: { batchNo: "B-1" },
    recognition: { extractedText: "新文字", warnings: [], fieldSources: {} },
  });
  await act(() => result.current.aiParseMessage());
  expect(replaceDraft.mock.calls[0][0].recognition?.images).toEqual([image]);
  expect(onTextRecognized).toHaveBeenCalledOnce();
});

it("ignores local standardization after a newer draft replaces its source", async () => {
  let finish!: (value: { item: string }) => void;
  vi.mocked(parseIntakeMessage).mockReturnValue({
    ...createIntakeDraft("录入人"),
    strainRaw: "C57",
    strainStandard: "C57",
  });
  vi.mocked(standardizeIntakeStrain).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result, revision, replaceDraft, onTextRecognized } = setup();
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.parseMessage();
  });
  revision.current += 1;
  await act(async () => {
    finish({ item: "C57BL/6J" });
    await pending;
  });
  expect(replaceDraft).not.toHaveBeenCalled();
  expect(onTextRecognized).not.toHaveBeenCalled();
});

it("ignores an AI response after unmount without reopening a merge preview", async () => {
  let finish!: (value: IntakeAiParseResponse) => void;
  vi.mocked(aiParseIntakeMessage).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const { result, unmount, replaceDraft, onTextRecognized } = setup();
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.aiParseMessage();
  });
  unmount();
  await act(async () => {
    finish({ item: { batchNo: "B-1" } });
    await pending;
  });
  expect(replaceDraft).not.toHaveBeenCalled();
  expect(onTextRecognized).not.toHaveBeenCalled();
});
