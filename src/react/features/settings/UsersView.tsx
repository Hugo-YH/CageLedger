import { ActionIcon } from "../../components/ui/ActionIcon";
import { useCallback, useState } from "react";
import { Alert, Button } from "antd";

import { useRooms } from "../../api/infrastructure";
import type { ManagedUser, SessionUser } from "../../api/contracts";
import { useDeleteUser, useUsers } from "../../api/administration";
import { ConfirmDialog, PageSkeleton, PageState, WorkspaceToolbar } from "../../components/WorkspaceUi";
import { ListRefreshStatus, ModalPresence } from "../../components/ui";
import { UserCreateForm, UserList, UserSaveProvider } from "./components/UserManagementPanels";

const EMPTY_ROOMS: NonNullable<ReturnType<typeof useRooms>["data"]>["items"] = [];

export function UsersView({ currentUser }: { currentUser: SessionUser }) {
  const users = useUsers(currentUser.role === "admin");
  const rooms = useRooms(currentUser.role === "admin");
  const remove = useDeleteUser();
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const selectDeleteTarget = useCallback((user: ManagedUser) => setDeleteTarget(user), []);
  const refetchRooms = rooms.refetch;
  const retryRooms = useCallback(() => void refetchRooms(), [refetchRooms]);
  if (currentUser.role !== "admin")
    return (
      <section className="workspace-view">
        <div className="workspace-body">
          <section className="panel">
            <PageState title="需要系统管理员权限" />
          </section>
        </div>
      </section>
    );
  if (users.isPending)
    return (
      <section className="workspace-view">
        <WorkspaceToolbar ariaLabel="账号管理" title="账号管理" />
        <PageSkeleton label="账号" variant="table" />
      </section>
    );
  if (users.isError && !users.data)
    return (
      <section className="workspace-view">
        <WorkspaceToolbar ariaLabel="账号管理" title="账号管理" />
        <PageState title="账号信息加载失败" retry={() => void users.refetch()} />
      </section>
    );
  const items = users.data?.users || [];
  const roomItems = rooms.data?.items || EMPTY_ROOMS;
  const roomsReady = Boolean(rooms.data) && !rooms.isError;
  return (
    <section className="workspace-view settings-workspace" data-feature="administration">
      <WorkspaceToolbar ariaLabel="账号管理" title="账号管理" />
      <div className="workspace-body settings-workspace-body">
        <ListRefreshStatus active={users.isFetching} />
        {users.isError ? (
          <Alert
            role="alert"
            showIcon
            type="error"
            title="账号信息更新失败，当前输入已保留"
            action={
              <Button
                icon={<ActionIcon name="refresh" />}
                loading={users.isFetching}
                onClick={() => void users.refetch()}
              >
                重试
              </Button>
            }
          />
        ) : null}
        <UserSaveProvider>
          <section className="settings-split-layout">
            <UserList
              currentUserId={currentUser.id}
              items={items}
              rooms={roomItems}
              roomsReady={roomsReady}
              roomsError={rooms.isError}
              onRetryRooms={retryRooms}
              onDelete={selectDeleteTarget}
            />
            <UserCreateForm
              rooms={roomItems}
              roomsReady={roomsReady}
              roomsError={rooms.isError}
              onRetryRooms={retryRooms}
            />
          </section>
        </UserSaveProvider>
      </div>
      <ModalPresence>
        {deleteTarget ? (
          <ConfirmDialog
            key={deleteTarget.id}
            title="删除账号"
            message={`确认删除账号“${deleteTarget.displayName}”？该账号将立即失去登录权限。`}
            confirmLabel="确认删除"
            danger
            pending={remove.isPending}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={() => remove.mutateAsync(deleteTarget.id)}
          />
        ) : null}
      </ModalPresence>
    </section>
  );
}
