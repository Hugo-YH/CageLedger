import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, renderHook } from "@testing-library/react";
import type { PropsWithChildren } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { fetchIacucSearch } from "../../../api/iacuc";
import { queryKeys } from "../../../api/queryKeys";
import { copyTextToClipboard } from "../../../utils/clipboard";
import { useCopyProjectPeople } from "./useCopyProjectPeople";

const message = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));
vi.mock("antd", () => ({ App: { useApp: () => ({ message }) } }));
vi.mock("../../../api/iacuc", () => ({ fetchIacucSearch: vi.fn() }));
vi.mock("../../../utils/clipboard", () => ({ copyTextToClipboard: vi.fn() }));

const project = { iacuc: "Z2026034", pi: "李壮", owner: "肖志强", project: "项目", funding: "" };
const batch = { id: "batch", iacuc: " z2026034 ", pi: "笼卡项目负责人", owner: "笼卡实验负责人" };

function setup() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const wrapper = ({ children }: PropsWithChildren) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  );
  return { ...renderHook(useCopyProjectPeople, { wrapper }), client };
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("reads current summary people instead of batch names or a previously cached project", async () => {
  const { result, client } = setup();
  client.setQueryData(queryKeys.iacucSearch("Z2026034", 80), { items: [{ ...project, pi: "旧负责人" }] });
  vi.mocked(fetchIacucSearch).mockResolvedValue({ items: [{ ...project, pi: " 李壮\t", owner: "肖志强\n" }] });
  vi.mocked(copyTextToClipboard).mockResolvedValue(true);
  await act(() => result.current.copy(batch));
  expect(fetchIacucSearch).toHaveBeenCalledWith("Z2026034", 80, expect.any(AbortSignal));
  expect(copyTextToClipboard).toHaveBeenCalledWith("李壮组肖志强");
  expect(message.success).toHaveBeenCalledWith("已复制：李壮组肖志强");
  expect(result.current.copyingId).toBe("");
});

it.each([
  { items: [] },
  { items: [{ ...project, iacuc: "Z20260340" }] },
  { items: [{ ...project, owner: "" }] },
  { items: [project, { ...project, owner: "另一位实验负责人" }] },
  { items: [project], count: 81 },
])("keeps the clipboard unchanged when summary information cannot be resolved: %j", async (response) => {
  vi.mocked(fetchIacucSearch).mockResolvedValue(response);
  const { result } = setup();
  await act(() => result.current.copy(batch));
  expect(copyTextToClipboard).not.toHaveBeenCalled();
  expect(message.error).toHaveBeenCalledOnce();
});

it("does not fall back to batch people when the summary request fails", async () => {
  vi.mocked(fetchIacucSearch).mockRejectedValue(new Error("查询失败"));
  const { result } = setup();
  await act(() => result.current.copy(batch));
  expect(copyTextToClipboard).not.toHaveBeenCalled();
  expect(message.error).toHaveBeenCalledWith("查询失败");
});

it("reports clipboard failure without announcing success", async () => {
  vi.mocked(fetchIacucSearch).mockResolvedValue({ items: [project] });
  vi.mocked(copyTextToClipboard).mockResolvedValue(false);
  const { result } = setup();
  await act(() => result.current.copy(batch));
  expect(message.success).not.toHaveBeenCalled();
  expect(message.error).toHaveBeenCalledOnce();
});

it("does not copy a delayed response after leaving the list, or start duplicate requests", async () => {
  let resolve!: (value: Awaited<ReturnType<typeof fetchIacucSearch>>) => void;
  vi.mocked(fetchIacucSearch).mockReturnValue(new Promise((done) => (resolve = done)));
  const { result, unmount } = setup();
  let pending!: Promise<void>;
  act(() => {
    pending = result.current.copy(batch);
    void result.current.copy(batch);
  });
  expect(fetchIacucSearch).toHaveBeenCalledOnce();
  unmount();
  await act(async () => {
    resolve({ items: [project] });
    await pending;
  });
  expect(copyTextToClipboard).not.toHaveBeenCalled();
});
