import { useId } from "react";
import { Alert, Button, Checkbox, Form, Input, Select, Typography } from "antd";

import type { CageRoom, UserRole } from "../../../api/contracts";

export interface UserDraft {
  username: string;
  displayName: string;
  phone: string;
  password: string;
  role: UserRole;
  roomIds: string[];
  billingLockAllowed: boolean;
}
export type UserErrors = Partial<Record<keyof UserDraft, string>>;

export function UserFields({
  draft,
  errors = {},
  rooms,
  roomsReady,
  roomsError,
  onRetryRooms,
  onChange,
  creating = false,
  disabled = false,
}: {
  draft: UserDraft;
  errors?: UserErrors;
  rooms: CageRoom[];
  roomsReady: boolean;
  roomsError: boolean;
  onRetryRooms?: () => void;
  onChange: (draft: UserDraft) => void;
  creating?: boolean;
  disabled?: boolean;
}) {
  const id = useId();
  const update = <K extends keyof UserDraft>(key: K, value: UserDraft[K]) => onChange({ ...draft, [key]: value });
  return (
    <Form disabled={disabled} className="user-fields-react" layout="vertical" requiredMark={false}>
      <Form.Item
        help={errors.username ? <span id={`${id}-username_help`}>{errors.username}</span> : undefined}
        validateStatus={errors.username ? "error" : undefined}
        htmlFor={`${id}-username`}
        label="登录名"
        required={creating}
      >
        <Input
          id={`${id}-username`}
          aria-invalid={Boolean(errors.username)}
          aria-describedby={errors.username ? `${id}-username_help` : undefined}
          autoComplete="username"
          value={draft.username}
          onChange={(event) => update("username", event.target.value)}
        />
      </Form.Item>
      <Form.Item
        help={errors.displayName ? <span id={`${id}-display-name_help`}>{errors.displayName}</span> : undefined}
        validateStatus={errors.displayName ? "error" : undefined}
        htmlFor={`${id}-display-name`}
        label="显示姓名"
        extra="留空时使用登录名"
      >
        <Input
          id={`${id}-display-name`}
          aria-invalid={Boolean(errors.displayName)}
          aria-describedby={errors.displayName ? `${id}-display-name_help` : undefined}
          value={draft.displayName}
          onChange={(event) => update("displayName", event.target.value)}
        />
      </Form.Item>
      <Form.Item htmlFor={`${id}-phone`} label="联系电话">
        <Input
          id={`${id}-phone`}
          type="tel"
          autoComplete="tel"
          value={draft.phone}
          placeholder="用于预约消息识别的联系电话"
          onChange={(event) => update("phone", event.target.value)}
        />
      </Form.Item>
      <Form.Item
        help={errors.password ? <span id={`${id}-password_help`}>{errors.password}</span> : undefined}
        validateStatus={errors.password ? "error" : undefined}
        htmlFor={`${id}-password`}
        label={creating ? "初始密码" : "新密码（留空保持）"}
        required={creating}
      >
        <Input.Password
          id={`${id}-password`}
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? `${id}-password_help` : undefined}
          autoComplete="new-password"
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
          {!roomsReady ? (
            roomsError ? (
              <Alert
                type="error"
                showIcon
                title="饲养间读取失败，当前授权已保留"
                action={<Button onClick={onRetryRooms}>重试</Button>}
              />
            ) : (
              <Typography.Text role="status">正在读取饲养间…</Typography.Text>
            )
          ) : null}
          <Checkbox.Group
            aria-label="饲养间授权"
            className="settings-room-access-group"
            options={rooms.map((room) => ({ label: room.name, value: room.id }))}
            value={draft.roomIds}
            disabled={!roomsReady || disabled}
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
