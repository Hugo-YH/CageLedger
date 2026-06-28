import { useEffect, useState } from "react";

import { useBootstrap } from "../../api/bootstrap";
import type { CageRoom, ManagedUser, SessionUser, UserRole } from "../../api/contracts";
import { useDeleteUser, useSaveUser, useUsers } from "../../api/administration";
import { ConfirmDialog, PageState, WorkspaceHeader } from "../../components/WorkspaceUi";

const emptyDraft = { username: "", displayName: "", password: "", role: "room_admin" as UserRole, roomIds: [] as string[] };
type UserDraft = typeof emptyDraft;

export function UsersView({ currentUser }: { currentUser: SessionUser }) {
  const users = useUsers(currentUser.role === "admin");
  const bootstrap = useBootstrap("summary");
  const save = useSaveUser();
  const remove = useDeleteUser();
  const [createDraft, setCreateDraft] = useState(emptyDraft);
  const [deleteTarget, setDeleteTarget] = useState<ManagedUser | null>(null);
  if (currentUser.role !== "admin") return <section className="workspace-view"><WorkspaceHeader kicker="权限工作台" title="账号管理" summary="账号管理仅向系统管理员开放。"/><div className="workspace-body"><section className="panel"><PageState title="需要系统管理员权限"/></section></div></section>;
  if (users.isPending || bootstrap.isPending) return <section className="workspace-view"><PageState title="正在加载账号与房间..."/></section>;
  if (users.isError || bootstrap.isError) return <section className="workspace-view"><PageState title="账号信息加载失败" retry={() => { users.refetch(); bootstrap.refetch(); }}/></section>;
  const items = users.data?.users || [];
  const rooms = (bootstrap.data?.rooms || []) as unknown as CageRoom[];
  async function createUser() { await save.mutateAsync({ user: createDraft }); setCreateDraft(emptyDraft); }
  return <section className="workspace-view settings-workspace"><WorkspaceHeader kicker="权限工作台" title="账号管理" summary="维护系统管理员和房间管理员，房间授权直接决定业务数据范围。" status={`${items.length} 个账号`}/><div className="workspace-body settings-workspace-body"><section className="settings-split-layout"><div className="panel large"><div className="panel-head"><div className="panel-title-line"><h2>账号列表</h2></div><div className="panel-head-actions"><span className="panel-summary-chip">管理员 {items.filter((item) => item.role === "admin").length} · 房间管理员 {items.filter((item) => item.role === "room_admin").length}</span></div></div><div className="user-list react-user-list">{items.map((item) => <UserEditor key={item.id} user={item} current={item.id === currentUser.id} rooms={rooms} pending={save.isPending} onSave={(user) => save.mutateAsync({ id: item.id, user })} onDelete={() => setDeleteTarget(item)}/>)}</div></div><section className="panel settings-side-panel"><div className="panel-head compact"><div className="panel-title-line"><h2>创建账号</h2></div></div><UserFields creating draft={createDraft} rooms={rooms} onChange={setCreateDraft}/><button className="primary" type="button" disabled={save.isPending || !createDraft.username || !createDraft.password} onClick={() => void createUser()}>创建账号</button></section></section></div>{deleteTarget ? <ConfirmDialog title="删除账号" message={`确认删除账号“${deleteTarget.displayName}”？该账号将立即失去登录权限。`} confirmLabel="确认删除" danger pending={remove.isPending} onCancel={() => setDeleteTarget(null)} onConfirm={async () => { await remove.mutateAsync(deleteTarget.id); setDeleteTarget(null); }}/> : null}</section>;
}

function UserEditor({ user, current, rooms, pending, onSave, onDelete }: { user: ManagedUser; current: boolean; rooms: CageRoom[]; pending: boolean; onSave: (user: Partial<ManagedUser> & { password?: string }) => Promise<unknown>; onDelete: () => void }) {
  const [draft, setDraft] = useState<UserDraft>(() => userDraft(user));
  useEffect(() => setDraft(userDraft(user)), [user]);
  return <article className="user-card"><div className="user-card-head"><div><strong>{user.displayName}</strong><span>{user.username} · {user.role === "admin" ? "系统管理员" : `${user.roomIds.length} 个授权饲养间`}</span></div>{current ? <span className="pill active">当前账号</span> : null}</div>{current ? null : <><UserFields draft={draft} rooms={rooms} onChange={setDraft}/><div className="form-actions"><button className="ghost danger-text compact" type="button" onClick={onDelete}>删除</button><button className="secondary info-button" type="button" disabled={pending} onClick={() => void onSave(draft)}>保存账号</button></div></>}</article>;
}

function userDraft(user: ManagedUser): UserDraft { return { username: user.username, displayName: user.displayName, password: "", role: user.role, roomIds: [...user.roomIds] }; }

function UserFields({ draft, rooms, onChange, creating = false }: { draft: UserDraft; rooms: CageRoom[]; onChange: (draft: UserDraft) => void; creating?: boolean }) {
  const update = <K extends keyof UserDraft>(key: K, value: UserDraft[K]) => onChange({ ...draft, [key]: value });
  return <div className="form user-fields-react"><label>登录名<input value={draft.username} onChange={(event) => update("username", event.target.value)}/></label><label>显示姓名<input value={draft.displayName} onChange={(event) => update("displayName", event.target.value)}/></label><label>{creating ? "初始密码" : "新密码（留空保持）"}<input type="password" value={draft.password} onChange={(event) => update("password", event.target.value)}/></label><label>角色<select value={draft.role} onChange={(event) => update("role", event.target.value as UserRole)}><option value="room_admin">房间管理员</option><option value="admin">系统管理员</option></select></label>{draft.role === "room_admin" ? <fieldset className="room-access-fieldset"><legend>饲养间授权</legend>{rooms.map((room) => <label className="check-row" key={room.id}><input type="checkbox" checked={draft.roomIds.includes(room.id)} onChange={(event) => update("roomIds", event.target.checked ? [...draft.roomIds, room.id] : draft.roomIds.filter((id) => id !== room.id))}/><span>{room.name}</span></label>)}</fieldset> : <p className="muted">系统管理员默认访问全部饲养间。</p>}</div>;
}
