import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useSyncExternalStore } from "react";
import type * as UiComponents from "../../components/ui";

import { FeedbackView } from "./FeedbackView";
import type { SessionUser } from "../../api/contracts";

const polling = vi.hoisted(() => ({ revision: 0, listeners: new Set<() => void>(), tableRenders: 0 }));

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: () => ({
    matches: false,
    addListener() {},
    removeListener() {},
    addEventListener() {},
    removeEventListener() {},
  }),
});
vi.stubGlobal(
  "ResizeObserver",
  class {
    observe() {}
    unobserve() {}
    disconnect() {}
  },
);

vi.mock("../../api/feedback", () => ({
  useFeedbackDetail: () => {
    useSyncExternalStore(
      (listener) => {
        polling.listeners.add(listener);
        return () => {
          polling.listeners.delete(listener);
        };
      },
      () => polling.revision,
    );
    return { isPending: false, isError: false, data: undefined, refetch: vi.fn() };
  },
  useFeedbackList: () => ({
    data: { total: 1, items: [{ id: "polling-item", number: 1, title: "轮询测试" }] },
    refetch: vi.fn(),
  }),
  useFeedbackIntegration: () => ({ data: undefined }),
  useQueueFeedbackSync: () => ({ isPending: false }),
  useSetFeedbackEncounter: () => ({ isPending: false }),
  useAddFeedbackComment: () => ({ isPending: false }),
  useCreateFeedback: () => ({ isPending: false }),
  uploadFeedbackAttachment: vi.fn(),
}));
vi.mock("../../api/administration", () => ({ useSystemInfo: () => ({ data: { build: "237" } }) }));
vi.mock("./FeedbackColumnTitle", () => ({ FeedbackColumnTitle: () => null }));
vi.mock("./FeedbackImportDrawer", () => ({ FeedbackImportDrawer: () => null }));
vi.mock("../../components/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof UiComponents>();
  return {
    ...actual,
    DataTable: ({
      columns,
      dataSource: rows,
    }: {
      columns: Array<{ key?: string; render?: (value: unknown, item: unknown) => React.ReactNode }>;
      dataSource: unknown[];
    }) => {
      polling.tableRenders += 1;
      return <div>{columns.find((column) => column.key === "content")?.render?.(undefined, rows[0])}</div>;
    },
  };
});

afterEach(() => {
  cleanup();
  polling.listeners.clear();
  polling.revision = 0;
  polling.tableRenders = 0;
});

it("detail polling updates its drawer without rendering the feedback list again", () => {
  const user: SessionUser = {
    id: "test",
    username: "test",
    displayName: "测试",
    role: "room_admin",
    roomIds: [],
    phone: "",
    active: true,
    updatedAt: "2026-10-23T00:00:00Z",
  };
  render(<FeedbackView user={user} page="feedback" />);
  fireEvent.click(screen.getByRole("button", { name: "查看反馈 #1：轮询测试" }));
  const before = polling.tableRenders;
  act(() => {
    polling.revision += 1;
    for (const listener of polling.listeners) listener();
  });
  expect(polling.tableRenders - before).toBe(0);
});
