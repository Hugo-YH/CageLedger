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
const feedback = vi.hoisted(() => ({ info: vi.fn() }));
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
