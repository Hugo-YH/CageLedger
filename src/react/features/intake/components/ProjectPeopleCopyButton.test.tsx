import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ButtonHTMLAttributes, PropsWithChildren, ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { fetchIacucSearch } from "../../../api/iacuc";
import { copyTextToClipboard } from "../../../utils/clipboard";
import { ProjectPeopleCopyButton, ProjectPeopleCopyProvider } from "./ProjectPeopleCopyButton";

const message = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn(), warning: vi.fn() }));

vi.mock("antd", () => ({
  App: { useApp: () => ({ message }) },
  Button: ({
    children,
    loading,
    ...props
  }: { children: ReactNode; loading?: boolean } & ButtonHTMLAttributes<HTMLButtonElement>) => (
    <button {...props} data-loading={loading ? "true" : "false"}>
      {children}
    </button>
  ),
  Tooltip: ({ children, title }: { children: ReactNode; title: ReactNode }) => (
    <span data-tooltip={String(title)}>{children}</span>
  ),
}));
vi.mock("../../../api/iacuc", () => ({ fetchIacucSearch: vi.fn() }));
vi.mock("../../../utils/clipboard", () => ({ copyTextToClipboard: vi.fn() }));

const first = { id: "batch-a", iacuc: " z2026034 ", owner: "批次甲负责人" };
const second = { id: "batch-b", iacuc: "Z2026035", owner: "批次乙负责人" };
const project = { iacuc: "Z2026034", pi: "汇总项目负责人", owner: "汇总实验负责人", project: "项目", funding: "" };

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((fulfill, fail) => {
    resolve = fulfill;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function TestProvider({ children }: PropsWithChildren) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return (
    <QueryClientProvider client={client}>
      <ProjectPeopleCopyProvider>{children}</ProjectPeopleCopyProvider>
    </QueryClientProvider>
  );
}

function renderButtons({ children }: { children?: ReactNode } = {}) {
  const TableShell = vi.fn(({ content }: { content: ReactNode }) => <div data-testid="table-shell">{content}</div>);
  const stableChildren = children ?? (
    <>
      <ProjectPeopleCopyButton item={first} />
      <ProjectPeopleCopyButton item={second} />
    </>
  );
  render(
    <TestProvider>
      <TableShell content={stableChildren} />
    </TestProvider>,
  );
  return {
    firstButton: screen.getByRole("button", { name: `复制项目负责人和实验负责人：${first.owner}` }),
    secondButton: screen.getByRole("button", { name: `复制项目负责人和实验负责人：${second.owner}` }),
    tableRenders: () => TableShell.mock.calls.length,
  };
}

function copyStatusTexts() {
  return screen.getAllByRole("status").map((element) => element.textContent);
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("updates only copy consumers through delayed query and clipboard phases", async () => {
  const lookup = deferred<Awaited<ReturnType<typeof fetchIacucSearch>>>();
  const clipboard = deferred<boolean>();
  vi.mocked(fetchIacucSearch).mockReturnValueOnce(lookup.promise);
  vi.mocked(copyTextToClipboard).mockReturnValueOnce(clipboard.promise);
  const view = renderButtons();
  const initialChildren = screen.getByTestId("table-shell").firstChild;

  await act(async () => {
    fireEvent.click(view.firstButton);
    await Promise.resolve();
  });
  expect(copyStatusTexts()).toContain("查询中…");
  expect(view.firstButton).toHaveAttribute("data-loading", "true");
  expect(view.firstButton.parentElement).toHaveAttribute("data-tooltip", "查询中…");
  expect(view.secondButton).toBeDisabled();
  expect(view.tableRenders()).toBe(1);
  expect(screen.getByTestId("table-shell").firstChild).toBe(initialChildren);

  await act(async () => {
    lookup.resolve({ items: [project] });
    await lookup.promise;
  });
  expect(copyStatusTexts()).toContain("复制中…");
  expect(copyTextToClipboard).toHaveBeenCalledWith("汇总项目负责人组汇总实验负责人");
  expect(view.tableRenders()).toBe(1);

  await act(async () => {
    clipboard.resolve(true);
    await clipboard.promise;
  });
  expect(copyStatusTexts()).toEqual(["", ""]);
  expect(view.firstButton).toHaveAttribute("data-loading", "false");
  expect(view.secondButton).not.toBeDisabled();
  expect(message.success).toHaveBeenCalledWith("已复制：汇总项目负责人组汇总实验负责人");
  expect(view.tableRenders()).toBe(1);
});

it("blocks a second row while the shared query is active", async () => {
  const lookup = deferred<Awaited<ReturnType<typeof fetchIacucSearch>>>();
  vi.mocked(fetchIacucSearch).mockReturnValueOnce(lookup.promise);
  vi.mocked(copyTextToClipboard).mockResolvedValueOnce(true);
  const view = renderButtons();

  await act(async () => {
    fireEvent.click(view.firstButton);
    fireEvent.click(view.secondButton);
    await Promise.resolve();
  });
  expect(fetchIacucSearch).toHaveBeenCalledOnce();
  expect(view.secondButton).toBeDisabled();

  await act(async () => {
    lookup.resolve({ items: [project] });
    await lookup.promise;
  });
  expect(copyTextToClipboard).toHaveBeenCalledOnce();
});

it("clears feedback state and permits a later copy after a query error", async () => {
  vi.mocked(fetchIacucSearch).mockRejectedValueOnce(new Error("项目汇总表暂不可用"));
  vi.mocked(fetchIacucSearch).mockResolvedValueOnce({ items: [project] });
  vi.mocked(copyTextToClipboard).mockResolvedValueOnce(true);
  const view = renderButtons();

  await act(async () => {
    fireEvent.click(view.firstButton);
    await Promise.resolve();
  });
  await waitFor(() => expect(message.error).toHaveBeenCalledWith("项目汇总表暂不可用"));
  expect(copyStatusTexts()).toEqual(["", ""]);
  expect(view.firstButton).not.toBeDisabled();

  await act(async () => {
    fireEvent.click(view.firstButton);
    await Promise.resolve();
  });
  await waitFor(() => expect(fetchIacucSearch).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(message.success).toHaveBeenCalledWith("已复制：汇总项目负责人组汇总实验负责人"));
});
