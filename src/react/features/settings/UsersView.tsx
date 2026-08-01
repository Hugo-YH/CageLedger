import { useEffect, useState } from "react";
import { Button, Card, Checkbox, Collapse, Form, Input, Select, Space, Tag, Typography } from "antd";

import { useBootstrap } from "../../api/bootstrap";
import type { CageRoom, ManagedUser, SessionUser, UserRole } from "../../api/contracts";
import { useDeleteUser, useSaveUser, useUsers } from "../../api/administration";
import { ConfirmDialog, PageState, WorkspaceHeader } from "../../components/WorkspaceUi";
import type { WorkspaceView } from "../../state/ui";
import { breadcrumb, settingsSwitchItems } from "../shell/workspaceNavigation";

const emptyDraft = {
  username: "",
  displayName: "",
  phone: "",
  password: "",
  role: "room_admin" as UserRole,
  roomIds: [] as string[],
};
type UserDraft = typeof emptyDraft;

export function UsersView({
  currentUser,
  navigate,
}: {
  currentUser: SessionUser;
  navigate: (view: WorkspaceView) => void;
}) {
  const users = useUsers(currentUser.role === "admin");
  const bootstrap = useBootstrap("summary");
  const save = useSaveUser();
  const remove = useDeleteUser();
  const [createDraft, setCreateDraft] = useState(emptyDraft);
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  if (currentUser.role !== "admin")
    return (
      <section className="workspace-view">
        <WorkspaceHeader
          kicker="权限工作台"
          title="账号管理"
          breadcrumbs={[breadcrumb("系统设置", () => navigate("rooms"))]}
          summary="账号管理仅向系统管理员开放。"
          switcherLabel="系统功能"
          switcherItems={settingsSwitchItems(navigate, false)}
        />
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
        <PageState title="正在加载账号与房间..." />
      </section>
    );
  if (users.isError || bootstrap.isError)
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
  async function createUser() {
    await save.mutateAsync({ user: createDraft });
    setCreateDraft(emptyDraft);
  }
  return (
    <section className="workspace-view settings-workspace">
      <WorkspaceHeader
        kicker="权限工作台"
        title="账号管理"
        breadcrumbs={[breadcrumb("系统设置", () => navigate("rooms"))]}
        summary="维护系统管理员和房间管理员，房间授权直接决定业务数据范围。"
        status={`${items.length} 个账号`}
        switcherLabel="系统功能"
        switcherItems={settingsSwitchItems(navigate, currentUser.role === "admin")}
      />
      <div className="workspace-body settings-workspace-body">
        <section className="settings-split-layout">
          <Card
            className="settings-user-list-card"
            title={
              <Typography.Title level={2} className="ant-card-section-title">
                账号列表
              </Typography.Title>
            }
            extra={
              <Tag>
                管理员 {items.filter((item) => item.role === "admin").length} · 房间管理员{" "}
                {items.filter((item) => item.role === "room_admin").length}
              </Tag>
            }
          >
            <Collapse
              className="settings-user-collapse"
              items={items.map((item) => ({
                key: item.id,
                label: (
                  <Space size={8} wrap>
                    <Typography.Text strong>{item.displayName}</Typography.Text>
                    <Typography.Text type="secondary">{item.username}</Typography.Text>
                    <Tag color={item.role === "admin" ? "blue" : "default"}>
                      {item.role === "admin" ? "系统管理员" : `${item.roomIds.length} 个授权饲养间`}
                    </Tag>
                    {item.id === currentUser.id ? <Tag color="processing">当前账号</Tag> : null}
                  </Space>
                ),
                children: (
                  <UserEditor
                    current={item.id === currentUser.id}
                    onDelete={() => setDeleteTarget(item)}
                    onSave={(next) => save.mutateAsync({ id: item.id, user: next, expectedUpdatedAt: item.updatedAt })}
                    pending={save.isPending}
                    rooms={rooms}
                    user={item}
                  />
                ),
              }))}
            />
          </Card>
          <Card className="settings-side-panel" size="small" title="创建账号">
            <UserFields creating draft={createDraft} rooms={rooms} onChange={setCreateDraft} />
            <Button
              block
              type="primary"
              loading={save.isPending}
              disabled={!createDraft.username || !createDraft.password}
              onClick={() => void createUser()}
            >
              创建账号
            </Button>
          </Card>
        </section>
      </div>
      {deleteTarget ? (
        <ConfirmDialog
          title="删除账号"
          message={`确认删除账号“${deleteTarget.displayName}”？该账号将立即失去登录权限。`}
          confirmLabel="确认删除"
          danger
          pending={remove.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={async () => {
            await remove.mutateAsync(deleteTarget.id);
            setDeleteTarget(null);
          }}
        />
      ) : null}
    </section>
  );
}

function UserEditor({
  user,
  current,
  rooms,
  pending,
  onSave,
  onDelete,
}: {
  user: ManagedUser;
  current: boolean;
  rooms: CageRoom[];
  pending: boolean;
  onSave: (user: Partial<ManagedUser> & { password?: string }) => Promise<unknown>;
  onDelete: () => void;
}) {
  const [draft, setDraft] = useState<UserDraft>(() => userDraft(user));
  useEffect(() => setDraft(userDraft(user)), [user]);
  if (current)
    return (
      <div className="settings-user-editor">
        <Typography.Text type="secondary">
          当前登录账号仅可维护联系电话，登录名、显示姓名与角色由其他管理员账号管理。
        </Typography.Text>
        <Form className="user-fields-react" layout="vertical" requiredMark={false}>
          <Form.Item htmlFor="managed-user-phone" label="联系电话">
            <Input
              id="managed-user-phone"
              value={draft.phone}
              placeholder="用于预约消息识别的联系电话"
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            />
          </Form.Item>
        </Form>
        <Space className="form-actions">
          <Button type="primary" loading={pending} onClick={() => void onSave({ phone: draft.phone })}>
            保存联系电话
          </Button>
        </Space>
      </div>
    );
  return (
    <div className="settings-user-editor">
      <UserFields draft={draft} rooms={rooms} onChange={setDraft} />
      <Space className="form-actions">
        <Button danger onClick={onDelete}>
          删除账号
        </Button>
        <Button type="primary" loading={pending} onClick={() => void onSave(draft)}>
          保存账号
        </Button>
      </Space>
    </div>
  );
}

function userDraft(user: ManagedUser): UserDraft {
  return {
    username: user.username,
    displayName: user.displayName,
    phone: user.phone || "",
    password: "",
    role: user.role,
    roomIds: [...user.roomIds],
  };
}

function UserFields({
  draft,
  rooms,
  onChange,
  creating = false,
}: {
  draft: UserDraft;
  rooms: CageRoom[];
  onChange: (draft: UserDraft) => void;
  creating?: boolean;
}) {
  const update = <K extends keyof UserDraft>(key: K, value: UserDraft[K]) => onChange({ ...draft, [key]: value });
  return (
    <Form className="user-fields-react" layout="vertical" requiredMark={false}>
      <Form.Item htmlFor="managed-user-username" label="登录名" required={creating}>
        <Input
          id="managed-user-username"
          value={draft.username}
          onChange={(event) => update("username", event.target.value)}
        />
      </Form.Item>
      <Form.Item htmlFor="managed-user-display-name" label="显示姓名" required={creating}>
        <Input
          id="managed-user-display-name"
          value={draft.displayName}
          onChange={(event) => update("displayName", event.target.value)}
        />
      </Form.Item>
      <Form.Item htmlFor="managed-user-phone" label="联系电话">
        <Input
          id="managed-user-phone"
          value={draft.phone}
          placeholder="用于预约消息识别的联系电话"
          onChange={(event) => update("phone", event.target.value)}
        />
      </Form.Item>
      <Form.Item
        htmlFor="managed-user-password"
        label={creating ? "初始密码" : "新密码（留空保持）"}
        required={creating}
      >
        <Input.Password
          id="managed-user-password"
          value={draft.password}
          onChange={(event) => update("password", event.target.value)}
        />
      </Form.Item>
      <Form.Item label="角色">
        <Select
          value={draft.role}
          options={[
            { value: "room_admin", label: "房间管理员" },
            { value: "admin", label: "系统管理员" },
          ]}
          onChange={(value) => update("role", value)}
        />
      </Form.Item>
      {draft.role === "room_admin" ? (
        <Form.Item className="room-access-fieldset" label="饲养间授权">
          <Checkbox.Group
            className="settings-room-access-group"
            options={rooms.map((room) => ({ label: room.name, value: room.id }))}
            value={draft.roomIds}
            onChange={(values) => update("roomIds", values.map(String))}
          />
        </Form.Item>
      ) : (
        <p className="muted">系统管理员默认访问全部饲养间。</p>
      )}
    </Form>
  );
}
