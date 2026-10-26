import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import type { FormEvent, ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { QuantitySheet, SessionUser } from "../../../api/contracts";
import { createQuantityRow, normalizeQuantitySheet } from "../../../../domain/quantitySheets";
import { useQuantitySheetEditor } from "./useQuantitySheetEditor";

const user: SessionUser = {
  id: "admin",
  username: "admin",
  displayName: "登记人员",
  phone: "",
  role: "admin",
  roomIds: [],
  active: true,
  updatedAt: "2026-10-01",
};
const rooms = [
  { id: "mouse", name: "小鼠房", roomManager: "房间管理员", defaultBillingItem: "mouse_standard" },
  { id: "rabbit", name: "兔房", roomManager: "兔房管理员", defaultBillingItem: "rabbit" },
];
function savedSheet() {
  return normalizeQuantitySheet({
    id: "existing-sheet",
    month: "2026-09",
    iacuc: "Z1",
    pi: "PI",
    roomId: "mouse",
    roomName: "小鼠房",
    manager: "原登记人员",
    updatedAt: "original-version",
    pageCount: 2,
    rows: [{ ...createQuantityRow("2026-09", true), cageCount: 2 }],
  });
}
const submitEvent = () => ({ preventDefault: vi.fn() }) as unknown as FormEvent;

describe("quantity editor draft lifecycle", () => {
  let client: QueryClient;
  let saveResponse: (sheet: QuantitySheet) => Response;
  let lookupResponse: (() => Promise<Response>) | undefined;
  let writes: Array<{ url: string; method: string; body: { sheet: QuantitySheet; expectedUpdatedAt: string } }>;
  function wrapper({ children }: { children: ReactNode }) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  }
  beforeEach(() => {
    client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false } } });
    writes = [];
    lookupResponse = undefined;
    saveResponse = (sheet) => Response.json({ item: { ...sheet, updatedAt: "server-version" } });
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
      const url = String(input);
      if (init?.method === "POST" || init?.method === "PUT") {
        const body = JSON.parse(String(init.body));
        writes.push({ url, method: init.method, body });
        return saveResponse(body.sheet);
      }
      if (url === "/api/quantity-sheet-rooms") return Response.json({ items: rooms });
      if (url === "/api/principal-identities") return Response.json({ items: [{ pi: "PI", freeCageAllowance: 10 }] });
      if (url.includes("/pi-history?")) return Response.json({ item: null });
      if (url.includes("/iacuc-index?")) return lookupResponse ? lookupResponse() : Response.json({ items: [] });
      throw new Error(`Unexpected request: ${url}`);
    });
  });
  afterEach(() => {
    cleanup();
    client.clear();
    vi.restoreAllMocks();
  });

  it("does not request editor metadata on the saved list until an edit starts", async () => {
    const { result, rerender } = renderHook(({ editing }) => useQuantitySheetEditor(user, "saved", editing), {
      wrapper,
      initialProps: { editing: false },
    });
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url) === "/api/quantity-sheet-rooms")).toBe(
      false,
    );
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url) === "/api/principal-identities")).toBe(
      false,
    );
    rerender({ editing: true });
    await waitFor(() => expect(result.current.metadataReady).toBe(true));
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url) === "/api/quantity-sheet-rooms")).toBe(
      true,
    );
    expect(vi.mocked(globalThis.fetch).mock.calls.some(([url]) => String(url) === "/api/principal-identities")).toBe(
      true,
    );
  });

  it("blocks saving after metadata failure and keeps the draft through retry", async () => {
    let failing = true;
    vi.mocked(globalThis.fetch).mockImplementation((input) => {
      const url = String(input);
      if (url === "/api/quantity-sheet-rooms") return Promise.resolve(Response.json({ items: rooms }));
      if (url === "/api/principal-identities")
        return Promise.resolve(
          failing ? Response.json({ error: "配置不可用" }, { status: 503 }) : Response.json({ items: [] }),
        );
      if (url.includes("/iacuc-index?")) return Promise.resolve(Response.json({ items: [] }));
      throw new Error(`Unexpected request: ${url}`);
    });
    const { result } = renderHook(() => useQuantitySheetEditor(user, "entry"), { wrapper });
    await waitFor(() => expect(result.current.metadataError).toBe(true));
    act(() => result.current.setField("funding", "未保存草稿"));
    act(() => result.current.requestSave(submitEvent()));
    expect(result.current.confirmSave).toBeNull();
    expect(result.current.notice).toContain("尚未就绪");
    expect(writes).toHaveLength(0);
    failing = false;
    act(() => result.current.retryMetadata());
    await waitFor(() => expect(result.current.metadataReady).toBe(true));
    expect(result.current.draft.funding).toBe("未保存草稿");
  });

  it("saves live editor rows with the original version and opens a fresh draft only after success", async () => {
    const { result } = renderHook(() => useQuantitySheetEditor(user, "saved", true), { wrapper });
    await waitFor(() => expect(result.current.rooms).toHaveLength(2));
    act(() => result.current.loadForEdit(savedSheet()));
    const liveRow = { ...result.current.draft.rows[0], cageCount: 8 };
    result.current.rowRefs.current = Array.from({ length: 62 }, (_, index) => ({
      getRow: () => (index === 0 ? liveRow : createQuantityRow("2026-09")),
      setCalculated: vi.fn(),
    }));
    act(() => result.current.requestSave(submitEvent()));
    expect(result.current.confirmSave?.rows[0].cageCount).toBe(8);
    expect(result.current.confirmSave?.pageCount).toBe(2);
    await act(async () => result.current.persistSheet());
    expect(writes).toHaveLength(1);
    expect(writes[0]).toMatchObject({
      url: "/api/quantity-sheets/existing-sheet",
      method: "PUT",
      body: { expectedUpdatedAt: "original-version", sheet: { manager: user.displayName, roomManager: "房间管理员" } },
    });
    expect(result.current.draft.id).not.toBe("existing-sheet");
    expect(result.current.draft.month).toBe("2026-09");
    expect(result.current.draft.iacuc).toBe("");
    expect(result.current.editorRows).toHaveLength(31);
    expect(result.current.editingDialog).toBe(false);
    expect(result.current.noticeKind).toBe("success");
  });

  it("retains the draft and row edits on a conflict without retrying the write", async () => {
    const { result } = renderHook(() => useQuantitySheetEditor(user, "saved", true), { wrapper });
    await waitFor(() => expect(result.current.rooms).toHaveLength(2));
    act(() => result.current.loadForEdit(savedSheet()));
    act(() => result.current.setField("funding", "刚修改的支撑经费"));
    const liveRow = { ...result.current.draft.rows[0], cageCount: 9 };
    result.current.rowRefs.current = [{ getRow: () => liveRow, setCalculated: vi.fn() }];
    act(() => result.current.requestSave(submitEvent()));
    saveResponse = () => Response.json({ error: "记录已修改，请刷新后重新编辑" }, { status: 409 });
    await act(async () => result.current.persistSheet());
    expect(writes).toHaveLength(1);
    expect(result.current.draft).toMatchObject({
      id: "existing-sheet",
      funding: "刚修改的支撑经费",
      updatedAt: "original-version",
    });
    expect(result.current.rowRefs.current[0]?.getRow().cageCount).toBe(9);
    expect(result.current.editingDialog).toBe(true);
    expect(result.current.confirmSave).toBeNull();
    expect(result.current.noticeKind).toBe("error");
  });

  it("keeps custom segments while applying the existing exemption and room-unit rules", async () => {
    const { result } = renderHook(() => useQuantitySheetEditor(user, "entry"), { wrapper });
    await waitFor(() => expect(result.current.initialLoading).toBe(false));
    act(() => result.current.loadForEdit(savedSheet()));
    act(() => {
      result.current.setFreeCageEnabled(true);
      result.current.setTierPriorityEnabled(true);
      result.current.addCustomBillingSegment();
    });
    const segments = result.current.draft.customBillingSegments;
    act(() => result.current.setFullExemption(true));
    expect(result.current.draft).toMatchObject({
      fullExemption: true,
      preferredFreeCages: null,
      freeCagePriority: null,
      tierCagePriority: null,
    });
    expect(result.current.draft.customBillingSegments).toEqual(segments);
    act(() => result.current.chooseRoom("rabbit"));
    expect(result.current.unit).toBe("animal_day");
    expect(result.current.animalDetails).toBe(true);
    expect(result.current.draft.roomManager).toBe("兔房管理员");
    expect(result.current.draft.customBillingSegments).toEqual(segments);
  });

  it("discards a pending IACUC fill after starting a new draft", async () => {
    let resolveLookup!: (response: Response) => void;
    lookupResponse = () =>
      new Promise<Response>((resolve) => {
        resolveLookup = resolve;
      });
    const { result } = renderHook(() => useQuantitySheetEditor(user, "entry"), { wrapper });
    await waitFor(() => expect(result.current.initialLoading).toBe(false));
    const originalId = result.current.draft.id;
    const pending = result.current.iacucLookup.apply("Z1");
    act(() => result.current.startNew());
    await act(async () => {
      resolveLookup(Response.json({ items: [{ iacuc: "Z1", pi: "旧请求PI", project: "旧项目" }] }));
      await pending;
    });
    expect(result.current.draft.id).not.toBe(originalId);
    expect(result.current.draft.iacuc).toBe("");
    expect(result.current.draft.pi).toBe("");
    expect(writes).toHaveLength(0);
  });
});
