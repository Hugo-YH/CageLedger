import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { CageRack } from "../../api/contracts";
import { RoomsView } from "./RoomsView";

const operationFeedback = vi.hoisted(() => ({
  success: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  error: vi.fn(),
  message: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
vi.mock("../../hooks/useOperationFeedback", () => ({ useOperationFeedback: () => operationFeedback }));

const api = vi.hoisted(() => ({
  listRenders: vi.fn(),
  slotIds: vi.fn(),
  slots: {
    data: undefined as
      { items: Array<{ id: string; rackId: string; row: number; col: number; status: "empty" }> } | undefined,
    isFetching: true,
    isError: false,
    refetch: vi.fn(),
  },
  save: vi.fn().mockResolvedValue({}),
  structure: {
    data: {
      rooms: [{ id: "room", name: "8014" }],
      racks: [{ id: "rack", roomId: "room", name: "rack", index: 1, rows: 1, cols: 1 }],
      roomSummaries: [{ roomId: "room", slotCount: 1 }],
      rackSummaries: [{ rackId: "rack", slotCount: 1 }],
    },
    isPending: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  },
}));
vi.mock("../../api/infrastructure", () => ({
  useInfrastructureStructure: () => api.structure,
  useRackSlots: (id: string) => {
    api.slotIds(id);
    return api.slots;
  },
}));
vi.mock("../../api/administration", () => ({
  useSaveInfrastructure: () => ({ isPending: false, mutateAsync: api.save }),
  useDeleteRoom: () => ({ isPending: false, mutateAsync: vi.fn() }),
}));
vi.mock("./components/RoomEditors", () => ({
  RoomEditor: ({
    draft,
    onChange,
    onClose,
  }: {
    draft: { name: string };
    onChange: (value: { name: string }) => void;
    onClose: () => void;
  }) => (
    <div>
      <input
        aria-label="编辑房间名称"
        value={draft.name}
        onChange={(event) => onChange({ ...draft, name: event.target.value })}
      />
      <button onClick={onClose}>关闭房间编辑</button>
    </div>
  ),
  RackEditor: ({
    draft,
    onChange,
    onSave,
  }: {
    draft: CageRack;
    onChange: (value: CageRack) => void;
    onSave: () => Promise<unknown>;
  }) => (
    <div>
      <button onClick={() => onChange({ ...draft, cols: 2 })}>增加列</button>
      <button onClick={() => void onSave()}>保存笼架</button>
    </div>
  ),
}));
vi.mock("../../components/WorkspaceUi", () => ({
  ConfirmDialog: () => null,
  ModalShell: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
  PageSkeleton: ({ label }: { label: string }) => <div>{label}加载中</div>,
  PageState: ({ title, retry }: { title: string; retry: () => void }) => (
    <div>
      {title}
      <button onClick={retry}>重新加载</button>
    </div>
  ),
  WorkspaceToolbar: ({
    title,
    actions,
    primaryAction,
  }: {
    title: string;
    actions?: ReactNode;
    primaryAction?: ReactNode;
  }) => (
    <header>
      {title}
      {actions}
      {primaryAction}
    </header>
  ),
}));
vi.mock("../../components/ui", () => ({
  ListRefreshStatus: () => null,
  ModalPresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("antd", () => {
  const Container = ({
    children,
    extra,
    className,
  }: {
    children?: ReactNode;
    extra?: ReactNode;
    className?: string;
  }) => {
    if (className === "settings-rooms-card") api.listRenders();
    return (
      <div className={className}>
        {extra}
        {children}
      </div>
    );
  };
  return {
    Alert: Container,
    Button: ({ children, onClick, disabled }: { children: ReactNode; onClick?: () => void; disabled?: boolean }) => (
      <button onClick={onClick} disabled={disabled}>
        {children}
      </button>
    ),
    Card: Container,
    Empty: () => null,
    Space: Container,
    Tag: Container,
    Typography: { Text: Container, Paragraph: Container },
  };
});

const user = {
  id: "admin",
  username: "admin",
  displayName: "管理员",
  phone: "",
  role: "admin" as const,
  roomIds: [],
  active: true,
  updatedAt: "",
};
const initialStructure = api.structure.data;
beforeEach(() => {
  api.structure.data = initialStructure;
  api.listRenders.mockClear();
  api.slotIds.mockClear();
  api.save.mockClear();
  api.slots = { data: undefined, isFetching: true, isError: false, refetch: vi.fn() };
});
afterEach(cleanup);

it("loads slots only for existing rack, retries failure, then preserves the slot delta", async () => {
  const view = render(<RoomsView user={user} />);
  expect(screen.getByText(/1 间 · 1 架 · 1 笼位/)).toBeInTheDocument();
  expect(api.slotIds).toHaveBeenLastCalledWith("");
  fireEvent.click(screen.getByRole("button", { name: "编辑" }));
  expect(api.slotIds).toHaveBeenLastCalledWith("rack");
  expect(screen.getByText("笼位加载中")).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "保存笼架" })).not.toBeInTheDocument();
  api.slots = { ...api.slots, isFetching: false, isError: true };
  view.rerender(<RoomsView user={user} />);
  fireEvent.click(screen.getByRole("button", { name: "重新加载" }));
  expect(api.slots.refetch).toHaveBeenCalledOnce();
  api.slots = {
    ...api.slots,
    isError: false,
    data: { items: [{ id: "original", rackId: "rack", row: 1, col: 1, status: "empty" }] },
  };
  view.rerender(<RoomsView user={user} />);
  await waitFor(() => expect(screen.getByRole("button", { name: "保存笼架" })).toBeInTheDocument());
  fireEvent.click(screen.getByRole("button", { name: "增加列" }));
  api.slots = {
    ...api.slots,
    isFetching: true,
    data: { items: [{ id: "newly-refetched", rackId: "rack", row: 1, col: 2, status: "empty" }] },
  };
  view.rerender(<RoomsView user={user} />);
  fireEvent.click(screen.getByRole("button", { name: "保存笼架" }));
  await waitFor(() =>
    expect(api.save).toHaveBeenCalledWith(
      expect.objectContaining({
        slots: [expect.objectContaining({ rackId: "rack", row: 1, col: 2 })],
        slotDeletes: [],
      }),
    ),
  );
});

it("opens a new rack without requesting existing slots", () => {
  render(<RoomsView user={user} />);
  fireEvent.click(screen.getByRole("button", { name: "新增笼架" }));
  expect(api.slotIds).toHaveBeenLastCalledWith("");
  expect(screen.getByRole("button", { name: "保存笼架" })).toBeInTheDocument();
});

it("preserves room/rack order and real slot totals without rendering the list for room or rack draft edits", () => {
  api.structure.data = {
    rooms: [
      { id: "b", name: "乙房间" },
      { id: "a", name: "甲房间" },
    ],
    racks: [
      { id: "a1", roomId: "a", name: "a1", index: 4, rows: 6, cols: 10 },
      { id: "b1", roomId: "b", name: "b1", index: 3, rows: 6, cols: 10 },
      { id: "a2", roomId: "a", name: "a2", index: 1, rows: 6, cols: 10 },
      { id: "b2", roomId: "b", name: "b2", index: 2, rows: 6, cols: 10 },
    ],
    roomSummaries: [
      { roomId: "a", slotCount: 43 },
      { roomId: "b", slotCount: 17 },
    ],
    rackSummaries: [
      { rackId: "b2", slotCount: 7 },
      { rackId: "a2", slotCount: 23 },
      { rackId: "a1", slotCount: 20 },
      { rackId: "b1", slotCount: 10 },
    ],
  };
  render(<RoomsView user={user} />);
  expect(screen.getByText(/2 间 · 4 架 · 60 笼位/)).toBeInTheDocument();
  const cards = document.querySelectorAll<HTMLElement>(".settings-room-card");
  expect(cards).toHaveLength(2);
  expect(within(cards[0]).getByText("乙房间")).toBeInTheDocument();
  expect(
    within(cards[0])
      .getAllByText(/^笼架 /)
      .map((node) => node.textContent),
  ).toEqual(["笼架 3", "笼架 2"]);
  expect(
    within(cards[1])
      .getAllByText(/^笼架 /)
      .map((node) => node.textContent),
  ).toEqual(["笼架 4", "笼架 1"]);
  expect(within(cards[0]).getByText(/10 笼位/)).toBeInTheDocument();
  expect(within(cards[1]).getByText(/23 笼位/)).toBeInTheDocument();
  const before = api.listRenders.mock.calls.length;
  fireEvent.click(within(cards[0]).getByRole("button", { name: "编辑房间" }));
  fireEvent.change(screen.getByLabelText("编辑房间名称"), { target: { value: "未保存的新名称" } });
  expect(screen.getByText("乙房间")).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "关闭房间编辑" }));
  fireEvent.click(screen.getByRole("button", { name: "新增笼架" }));
  fireEvent.click(screen.getByRole("button", { name: "增加列" }));
  expect(api.listRenders).toHaveBeenCalledTimes(before);
  expect(api.slotIds).toHaveBeenLastCalledWith("");
});

it("updates changed structure and permission controls instead of retaining a memoized old list", () => {
  const view = render(<RoomsView user={user} />);
  api.structure.data = {
    ...initialStructure,
    roomSummaries: [{ roomId: "room", slotCount: 9 }],
    rackSummaries: [{ rackId: "rack", slotCount: 9 }],
  };
  view.rerender(<RoomsView user={{ ...user, role: "room_admin" }} />);
  expect(screen.getByText(/1 间 · 1 架 · 9 笼位/)).toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "编辑房间" })).not.toBeInTheDocument();
  expect(screen.queryByRole("button", { name: "新增饲养间" })).not.toBeInTheDocument();
  expect(screen.getByRole("button", { name: "编辑" })).toBeInTheDocument();
});
