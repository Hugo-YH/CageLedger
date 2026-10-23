import { ActionIcon } from "../../components/ui/ActionIcon";
import { useCallback, useState } from "react";
import { Alert, Button } from "antd";

import { useBootstrap } from "../../api/bootstrap";
import type { CageRoom, ManagedUser, SessionUser } from "../../api/contracts";
import { useDeleteUser, useUsers } from "../../api/administration";
import { ConfirmDialog, PageSkeleton, PageState, WorkspaceToolbar } from "../../components/WorkspaceUi";
import { ListRefreshStatus, ModalPresence } from "../../components/ui";
import { UserCreateForm, UserList, UserSaveProvider } from "./components/UserManagementPanels";

export function UsersView({ currentUser }: { currentUser: SessionUser }) {
  const users = useUsers(currentUser.role === "admin");
  const bootstrap = useBootstrap("summary");
  const remove = useDeleteUser();
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  const selectDeleteTarget = useCallback((user: ManagedUser) => setDeleteTarget(user), []);
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
  if (users.isPending || bootstrap.isPending)
    return (
      <section className="workspace-view">
        <PageSkeleton label="账号与房间" variant="table" />
      </section>
    );
  if ((users.isError && !users.data) || (bootstrap.isError && !bootstrap.data))
    return (
      <section className="workspace-view">
        <PageState
          title="账号信息加载失败"
          retry={() => {
            void users.refetch();
            void bootstrap.refetch();
          }}
        />
      </section>
    );
  const items = users.data?.users || [];
  const rooms = (bootstrap.data?.rooms || []) as unknown as CageRoom[];
  return (
    <section className="workspace-view settings-workspace" data-feature="administration">
      <WorkspaceToolbar ariaLabel="账号管理" title="账号管理" />
      <div className="workspace-body settings-workspace-body">
        <ListRefreshStatus active={users.isFetching || bootstrap.isFetching} />
        {users.isError || bootstrap.isError ? (
          <Alert
            role="alert"
            showIcon
            type="error"
            title="账号与房间信息更新失败，当前输入已保留"
            action={
              <Button
                icon={<ActionIcon name="refresh" />}
                loading={users.isFetching || bootstrap.isFetching}
                onClick={() => {
                  void users.refetch();
                  void bootstrap.refetch();
                }}
              >
                重试
              </Button>
            }
          />
        ) : null}
        <UserSaveProvider>
          <section className="settings-split-layout">
            <UserList currentUserId={currentUser.id} items={items} rooms={rooms} onDelete={selectDeleteTarget} />
            <UserCreateForm rooms={rooms} />
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
