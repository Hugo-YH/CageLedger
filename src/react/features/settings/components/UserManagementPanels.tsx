import { useOperationFeedback } from "../../../hooks/useOperationFeedback";
import { useEffect, useId, useRef, useState, memo, useCallback, useContext, type ReactNode } from "react";
import { Alert, Button, Card, Collapse, Form, Input, Space, Tag, Typography } from "antd";

import type { CageRoom, ManagedUser } from "../../../api/contracts";
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

import { UserFields, type UserDraft, type UserErrors } from "./UserFields";

const CREATE_SAVE_ID = "__create-user__";

const emptyDraft: UserDraft = {
  username: "",
  displayName: "",
  phone: "",
  password: "",
  role: "room_admin",
  roomIds: [],
  billingLockAllowed: false,
};
function userErrors(draft: UserDraft, creating = false): UserErrors {
  return {
    ...(!draft.username.trim() ? { username: "请填写登录名" } : {}),
    ...(creating && !draft.password ? { password: "请填写初始密码" } : {}),
  };
}
function focusError(root: HTMLDivElement | null) {
  requestAnimationFrame(() => root?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
}

export function UserSaveProvider({ children }: { children: ReactNode }) {
  const feedback = useOperationFeedback();
  const save = useSaveUser();
  const mutation = useRef(save.mutateAsync);
  const inFlight = useRef<Promise<void> | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  useEffect(() => {
    mutation.current = save.mutateAsync;
  }, [save.mutateAsync]);

  const saveUser = useCallback(
    async (nextPendingId: string, payload: UserSavePayload) => {
      if (inFlight.current) throw new Error("另一个账号正在保存，请等待完成后再试。");
      setPendingId(nextPendingId);
      const pending = Promise.resolve(mutation.current(payload)).then(() => undefined);
      inFlight.current = pending;
      try {
        await pending;
        feedback.success(
          payload.id ? "账号信息已保存" : "账号已创建",
          payload.user.displayName || payload.user.username,
        );
      } finally {
        inFlight.current = null;
        setPendingId(null);
      }
    },
    [feedback],
  );

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
  roomsReady = true,
  roomsError = false,
  onRetryRooms,
  onDelete,
}: {
  currentUserId: string;
  items: ManagedUser[];
  rooms: CageRoom[];
  roomsReady?: boolean;
  roomsError?: boolean;
  onRetryRooms?: () => void;
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
          children: (
            <UserEditor
              current={item.id === currentUserId}
              onDelete={onDelete}
              rooms={rooms}
              roomsReady={roomsReady}
              roomsError={roomsError}
              onRetryRooms={onRetryRooms}
              user={item}
            />
          ),
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
  roomsReady,
  roomsError,
  onRetryRooms,
  onDelete,
}: {
  user: ManagedUser;
  current: boolean;
  rooms: CageRoom[];
  roomsReady: boolean;
  roomsError: boolean;
  onRetryRooms?: () => void;
  onDelete: (user: ManagedUser) => void;
}) {
  const [draft, setDraft] = useState<UserDraft>(() => userDraft(user));
  const [baseline, setBaseline] = useState(user);
  const [serverSnapshot, setServerSnapshot] = useState(user);
  const [errors, setErrors] = useState<UserErrors>({});
  const editor = useRef<HTMLDivElement>(null);
  const dirty = JSON.stringify(draft) !== JSON.stringify(userDraft(baseline));
  const action = useAsyncFormAction("账号保存失败，请重试");
  const saveUser = useUserSaveAction();
  const phoneId = useId();
  useEffect(() => {
    if (!dirty && !action.pending && user !== serverSnapshot) {
      setBaseline(user);
      setDraft(userDraft(user));
      setServerSnapshot(user);
    }
  }, [user, serverSnapshot, dirty, action.pending]);
  const conflict = dirty && user.updatedAt !== baseline.updatedAt;
  const conflictNotice = conflict ? (
    <Alert
      showIcon
      type="warning"
      title="账号资料已更新，当前输入已保留"
      description="请核对最新资料后重新编辑，避免覆盖其他管理员的修改。"
      action={
        <Button
          disabled={action.pending}
          onClick={() => {
            setBaseline(user);
            setServerSnapshot(user);
            setDraft(userDraft(user));
            setErrors({});
            action.setError("");
          }}
        >
          放弃修改并载入最新资料
        </Button>
      }
    />
  ) : null;
  const save = () => {
    if (conflict) return;
    const nextErrors = current ? {} : userErrors(draft);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      focusError(editor.current);
      return;
    }
    return action.run(
      () =>
        saveUser(user.id, {
          id: user.id,
          user: current ? { phone: draft.phone } : draft,
          expectedUpdatedAt: baseline.updatedAt,
        }),
      () => {
        setBaseline({ ...baseline, ...draft });
        setServerSnapshot(user);
        setDraft({ ...draft, password: "" });
      },
    );
  };
  if (current)
    return (
      <div ref={editor} className="settings-user-editor">
        {conflictNotice}
        {action.error ? <Alert role="alert" showIcon title={action.error} type="error" /> : null}
        <Typography.Text type="secondary">
          当前登录账号仅可维护联系电话，登录名、显示姓名与角色由其他管理员账号管理。
        </Typography.Text>
        <Form className="user-fields-react" layout="vertical" requiredMark={false}>
          <Form.Item htmlFor={phoneId} label="联系电话">
            <Input
              id={phoneId}
              type="tel"
              autoComplete="tel"
              disabled={action.pending}
              value={draft.phone}
              placeholder="用于预约消息识别的联系电话"
              onChange={(event) => setDraft({ ...draft, phone: event.target.value })}
            />
          </Form.Item>
        </Form>
        <Space className="form-actions">
          <UserSaveButton pendingId={user.id} disabled={conflict || action.pending} onClick={() => void save()}>
            保存联系电话
          </UserSaveButton>
        </Space>
      </div>
    );
  return (
    <div ref={editor} className="settings-user-editor">
      {conflictNotice}
      {action.error ? <Alert role="alert" showIcon title={action.error} type="error" /> : null}
      <UserFields
        disabled={action.pending}
        draft={draft}
        errors={errors}
        rooms={rooms}
        roomsReady={roomsReady}
        roomsError={roomsError}
        onRetryRooms={onRetryRooms}
        onChange={setDraft}
      />
      <Space className="form-actions">
        <Button danger disabled={action.pending} onClick={() => onDelete(user)}>
          删除账号
        </Button>
        <UserSaveButton
          pendingId={user.id}
          disabled={conflict || action.pending || (draft.role === "room_admin" && !roomsReady)}
          onClick={() => void save()}
        >
          保存账号
        </UserSaveButton>
      </Space>
    </div>
  );
}

export function UserCreateForm({
  rooms,
  roomsReady = true,
  roomsError = false,
  onRetryRooms,
}: {
  rooms: CageRoom[];
  roomsReady?: boolean;
  roomsError?: boolean;
  onRetryRooms?: () => void;
}) {
  const [draft, setDraft] = useState<UserDraft>(emptyDraft);
  const [errors, setErrors] = useState<UserErrors>({});
  const editor = useRef<HTMLDivElement>(null);
  const action = useAsyncFormAction("创建账号失败，请重试");
  const saveUser = useUserSaveAction();
  return (
    <Card className="settings-side-panel" size="small" title="创建账号">
      <div ref={editor}>
        {action.error ? <Alert role="alert" showIcon title={action.error} type="error" /> : null}
        <UserFields
          creating
          disabled={action.pending}
          draft={draft}
          errors={errors}
          rooms={rooms}
          roomsReady={roomsReady}
          roomsError={roomsError}
          onRetryRooms={onRetryRooms}
          onChange={setDraft}
        />
        <UserSaveButton
          pendingId={CREATE_SAVE_ID}
          block
          icon={<ActionIcon name="create" />}
          disabled={action.pending || (draft.role === "room_admin" && !roomsReady)}
          onClick={() => {
            const nextErrors = userErrors(draft, true);
            setErrors(nextErrors);
            if (Object.keys(nextErrors).length) {
              focusError(editor.current);
              return;
            }
            void action.run(
              () => saveUser(CREATE_SAVE_ID, { user: draft }),
              () => {
                setDraft(emptyDraft);
                setErrors({});
              },
            );
          }}
        >
          创建账号
        </UserSaveButton>
      </div>
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
