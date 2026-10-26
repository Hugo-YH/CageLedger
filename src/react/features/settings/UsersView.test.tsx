import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, expect, it, vi } from "vitest";

import { UsersView } from "./UsersView";

const api = vi.hoisted(() => ({
  rooms: { data: undefined, isError: false, isPending: true, isFetching: true, refetch: vi.fn() },
  users: { data: { users: [{ id: "one" }] }, isError: false, isPending: false, isFetching: false, refetch: vi.fn() },
}));
vi.mock("../../api/infrastructure", () => ({ useRooms: () => api.rooms }));
vi.mock("../../api/administration", () => ({ useUsers: () => api.users, useDeleteUser: () => ({ isPending: false }) }));
vi.mock("./components/UserManagementPanels", () => ({
  UserSaveProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  UserList: ({
    items,
    roomsReady,
    roomsError,
    onRetryRooms,
  }: {
    items: unknown[];
    roomsReady: boolean;
    roomsError: boolean;
    onRetryRooms: () => void;
  }) => (
    <div>
      账号 {items.length}{" "}
      {roomsReady ? "房间就绪" : roomsError ? <button onClick={onRetryRooms}>重试房间</button> : "房间加载中"}
    </div>
  ),
  UserCreateForm: () => null,
}));
vi.mock("../../components/WorkspaceUi", () => ({
  ConfirmDialog: () => null,
  PageSkeleton: () => <div>账号加载中</div>,
  PageState: () => <div>账号失败</div>,
  WorkspaceToolbar: () => <h1>账号管理</h1>,
}));
vi.mock("../../components/ui", () => ({
  ListRefreshStatus: () => null,
  ModalPresence: ({ children }: { children: ReactNode }) => <>{children}</>,
}));
vi.mock("antd", () => ({
  Alert: () => null,
  Button: ({ children }: { children: ReactNode }) => <button>{children}</button>,
}));

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it("shows the account list while rooms load or fail and retries rooms locally", () => {
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
  const view = render(<UsersView currentUser={user} />);
  expect(screen.getByText(/账号 1/)).toHaveTextContent("房间加载中");
  api.rooms = { ...api.rooms, isError: true, isPending: false, isFetching: false };
  view.rerender(<UsersView currentUser={user} />);
  expect(screen.getByText(/账号 1/)).toBeInTheDocument();
  fireEvent.click(screen.getByRole("button", { name: "重试房间" }));
  expect(api.rooms.refetch).toHaveBeenCalledOnce();
});
