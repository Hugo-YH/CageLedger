import { useEffect, useId, useRef, useState, memo, useCallback, useContext, type ReactNode } from "react";
import { Alert, Button, Card, Checkbox, Collapse, Form, Input, Select, Space, Tag, Typography } from "antd";

import type { CageRoom, ManagedUser, UserRole } from "../../../api/contracts";
import { useSaveUser } from "../../../api/administration";
import { CommandBar } from "../../../components/ui";
import { ActionIcon } from "../../../components/ui/ActionIcon";
import { useAsyncFormAction } from "../../../hooks/useAsyncFormAction";
import {
  UserSaveActionContext,
  UserSaveStatusContext,
  useUserSaveAction,
  type UserSavePayload,
} from "./UserSaveContext";

const CREATE_SAVE_ID = "__create-user__";

const emptyDraft = {
  username: "",
  displayName: "",
  phone: "",
  password: "",
  role: "room_admin" as UserRole,
  roomIds: [] as string[],
  billingLockAllowed: false,
};
type UserDraft = typeof emptyDraft;

export function UserSaveProvider({ children }: { children: ReactNode }) {
  const save = useSaveUser();
  const mutation = useRef(save.mutateAsync);
  const inFlight = useRef<Promise<void> | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  useEffect(() => {
    mutation.current = save.mutateAsync;
  }, [save.mutateAsync]);

  const saveUser = useCallback(async (nextPendingId: string, payload: UserSavePayload) => {
    if (inFlight.current) throw new Error("另一个账号正在保存，请等待完成后再试。");
    setPendingId(nextPendingId);
    const pending = Promise.resolve(mutation.current(payload)).then(() => undefined);
    inFlight.current = pending;
    try {
      await pending;
    } finally {
      inFlight.current = null;
      setPendingId(null);
    }
  }, []);

  return (
    <UserSaveActionContext.Provider value={saveUser}>
      <UserSaveStatusContext.Provider value={pendingId}>{children}</UserSaveStatusContext.Provider>
    </UserSaveActionContext.Provider>
  );
}

const UserSaveButton = memo(function UserSaveButton({
  pendingId,
  disabled = false,
  block = false,
  icon,
  children,
  onClick,
}: {
  pendingId: string;
  disabled?: boolean;
  block?: boolean;
  icon?: ReactNode;
  children: ReactNode;
  onClick: () => void;
}) {
  const activeSave = useContext(UserSaveStatusContext);
  const saving = activeSave === pendingId;
  return (
    <Button
      block={block}
      icon={icon}
      type="primary"
      disabled={disabled || Boolean(activeSave)}
      loading={saving}
      onClick={onClick}
    >
      {children}
    </Button>
  );
});

export const UserList = memo(function UserList({
  currentUserId,
  items,
  rooms,
  onDelete,
}: {
  currentUserId: string;
  items: ManagedUser[];
  rooms: CageRoom[];
  onDelete: (user: ManagedUser) => void;
}) {
  return (
    <Card className="settings-user-list-card">
      <CommandBar
        ariaLabel="账号列表"
        title="账号列表"
        titleSize="section"
        context={
          <Tag>
            管理员 {items.filter((item) => item.role === "admin").length} · 房间管理员{" "}
            {items.filter((item) => item.role === "room_admin").length}
          </Tag>
        }
      />
      <Collapse
        className="settings-user-collapse"
        items={items.map((item) => ({
          key: item.id,
          label: <UserListLabel current={item.id === currentUserId} user={item} />,
          children: <UserEditor current={item.id === currentUserId} onDelete={onDelete} rooms={rooms} user={item} />,
        }))}
      />
    </Card>
  );
});

function UserListLabel({ current, user }: { current: boolean; user: ManagedUser }) {
  return (
    <Space size={8} wrap>
      <Typography.Text strong>{user.displayName}</Typography.Text>
      <Typography.Text type="secondary">{user.username}</Typography.Text>
      <Tag color={user.role === "admin" ? "blue" : "default"}>
        {user.role === "admin" ? "系统管理员" : `${user.roomIds.length} 个授权饲养间`}
      </Tag>
      {current ? <Tag color="processing">当前账号</Tag> : null}
    </Space>
  );
}

function UserEditor({
  user,
  current,
  rooms,
  onDelete,
}: {
  user: ManagedUser;
  current: boolean;
  rooms: CageRoom[];
  onDelete: (user: ManagedUser) => void;
}) {
  const [draft, setDraft] = useState<UserDraft>(() => userDraft(user));
  const action = useAsyncFormAction("账号保存失败，请重试");
  const saveUser = useUserSaveAction();
  const phoneId = useId();
  useEffect(() => setDraft(userDraft(user)), [user]);
  const save = () =>
    action.run(() =>
      saveUser(user.id, {
        id: user.id,
        user: current ? { phone: draft.phone } : draft,
        expectedUpdatedAt: user.updatedAt,
      }),
    );
  if (current)
    return (
      <div className="settings-user-editor">
        {action.error ? <Alert role="alert" showIcon title={action.error} type="error" /> : null}
        <Typography.Text type="secondary">
          当前登录账号仅可维护联系电话，登录名、显示姓名与角色由其他管理员账号管理。
        </Typography.Text>
        <Form className="user-fields-react" layout="vertical" requiredMark={false}>
          <Form.Item htmlFor={phoneId} label="联系电话">
            <Input
              id={phoneId}
              disabled={action.pending}
              value={draft.phone}
              placeholder="用于预约消息识别的联系电话"
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            />
          </Form.Item>
        </Form>
        <Space className="form-actions">
          <UserSaveButton pendingId={user.id} disabled={action.pending} onClick={() => void save()}>
            保存联系电话
          </UserSaveButton>
        </Space>
      </div>
    );
  return (
    <div className="settings-user-editor">
      {action.error ? <Alert role="alert" showIcon title={action.error} type="error" /> : null}
      <UserFields disabled={action.pending} draft={draft} rooms={rooms} onChange={setDraft} />
      <Space className="form-actions">
        <Button danger onClick={() => onDelete(user)}>
          删除账号
        </Button>
        <UserSaveButton pendingId={user.id} disabled={action.pending} onClick={() => void save()}>
          保存账号
        </UserSaveButton>
      </Space>
    </div>
  );
}

export function UserCreateForm({ rooms }: { rooms: CageRoom[] }) {
  const [draft, setDraft] = useState<UserDraft>(emptyDraft);
  const action = useAsyncFormAction("创建账号失败，请重试");
  const saveUser = useUserSaveAction();
  return (
    <Card className="settings-side-panel" size="small" title="创建账号">
      {action.error ? <Alert role="alert" showIcon title={action.error} type="error" /> : null}
      <UserFields creating disabled={action.pending} draft={draft} rooms={rooms} onChange={setDraft} />
      <UserSaveButton
        pendingId={CREATE_SAVE_ID}
        block
        icon={<ActionIcon name="create" />}
        disabled={!draft.username || !draft.password || action.pending}
        onClick={() =>
          void action.run(
            () => saveUser(CREATE_SAVE_ID, { user: draft }),
            () => setDraft(emptyDraft),
          )
        }
      >
        创建账号
      </UserSaveButton>
    </Card>
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
    billingLockAllowed: Boolean(user.billingLockAllowed),
  };
}

function UserFields({
  draft,
  rooms,
  onChange,
  creating = false,
  disabled = false,
}: {
  draft: UserDraft;
  rooms: CageRoom[];
  onChange: (draft: UserDraft) => void;
  creating?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const update = <K extends keyof UserDraft>(key: K, value: UserDraft[K]) => onChange({ ...draft, [key]: value });
  return (
    <Form disabled={disabled} className="user-fields-react" layout="vertical" requiredMark={false}>
      <Form.Item htmlFor={`${id}-username`} label="登录名" required={creating}>
        <Input
          id={`${id}-username`}
          value={draft.username}
          onChange={(event) => update("username", event.target.value)}
        />
      </Form.Item>
      <Form.Item htmlFor={`${id}-display-name`} label="显示姓名" required={creating}>
        <Input
          id={`${id}-display-name`}
          value={draft.displayName}
          onChange={(event) => update("displayName", event.target.value)}
        />
      </Form.Item>
      <Form.Item htmlFor={`${id}-phone`} label="联系电话">
        <Input
          id={`${id}-phone`}
          value={draft.phone}
          placeholder="用于预约消息识别的联系电话"
          onChange={(event) => update("phone", event.target.value)}
        />
      </Form.Item>
      <Form.Item htmlFor={`${id}-password`} label={creating ? "初始密码" : "新密码（留空保持）"} required={creating}>
        <Input.Password
          id={`${id}-password`}
          value={draft.password}
          onChange={(event) => update("password", event.target.value)}
        />
      </Form.Item>
      <Form.Item htmlFor={`${id}-role`} label="角色">
        <Select
          id={`${id}-role`}
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
            aria-label="饲养间授权"
            className="settings-room-access-group"
            options={rooms.map((room) => ({ label: room.name, value: room.id }))}
            value={draft.roomIds}
            onChange={(values) => update("roomIds", values.map(String))}
          />
        </Form.Item>
      ) : (
        <p className="muted">系统管理员默认访问全部饲养间。</p>
      )}
      <Form.Item label="结算流程锁定权限">
        <Checkbox
          checked={draft.billingLockAllowed}
          onChange={(event) => update("billingLockAllowed", event.target.checked)}
        >
          允许锁定、解锁结算流程，撤回本人或他人经手的未归档单据、导出月度汇总，并可为已归档流程补录报销单
        </Checkbox>
      </Form.Item>
    </Form>
  );
}
