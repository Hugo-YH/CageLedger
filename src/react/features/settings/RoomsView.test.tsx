import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import type { CageRack } from "../../api/contracts";
import { RoomsView } from "./RoomsView";

const api = vi.hoisted(() => ({
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
  RoomEditor: () => null,
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
  const Container = ({ children, extra }: { children?: ReactNode; extra?: ReactNode }) => (
    <div>
      {extra}
      {children}
    </div>
  );
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
beforeEach(() => {
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
