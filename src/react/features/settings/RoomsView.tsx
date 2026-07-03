import { useState } from "react";

import { useBootstrap } from "../../api/bootstrap";
import type { CageRack, CageRoom, CageSlot, SessionUser } from "../../api/contracts";
import { useDeleteRoom, useSaveInfrastructure } from "../../api/administration";
import { ConfirmDialog, PageState, WorkspaceHeader } from "../../components/WorkspaceUi";
import { RackEditor, RoomEditor } from "./components/RoomEditors";
import { facilityLabel, generateSlots, newRackDraft, newRoomDraft, type RoomDraft, slotKey } from "./model";
import type { WorkspaceView } from "../../state/ui";
import { breadcrumb, settingsSwitchItems } from "../shell/workspaceNavigation";

export function RoomsView({ user, navigate }: { user: SessionUser; navigate: (view: WorkspaceView) => void }) {
  const query = useBootstrap("full");
  const save = useSaveInfrastructure();
  const removeRoom = useDeleteRoom();
  const [roomDraft, setRoomDraft] = useState<RoomDraft | null>(null);
  const [rackDraft, setRackDraft] = useState<CageRack | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "room" | "rack"; id: string; label: string } | null>(null);
  const canManageRooms = user.role === "admin";
  if (query.isPending)
    return (
      <section className="workspace-view">
        <PageState title="正在加载基础设施..." />
      </section>
    );
  if (query.isError || !query.data)
    return (
      <section className="workspace-view">
        <PageState title="基础设施加载失败" retry={() => query.refetch()} />
      </section>
    );
  const { rooms, racks, slots } = query.data;
  const visibleRooms = rooms as unknown as CageRoom[];
  const cageRacks = racks as unknown as CageRack[];
  const cageSlots = slots as unknown as CageSlot[];
  async function persistRoom() {
    if (!roomDraft?.name.trim()) return;
    const exists = visibleRooms.some((room) => room.id === roomDraft.id);
    await save.mutateAsync(exists ? { roomUpdates: [roomDraft] } : { rooms: [roomDraft] });
    setRoomDraft(null);
  }
  async function persistRack() {
    if (!rackDraft?.roomId || rackDraft.rows < 1 || rackDraft.cols < 1) return;
    const existing = cageRacks.find((rack) => rack.id === rackDraft.id);
    const room = visibleRooms.find((item) => item.id === rackDraft.roomId);
    if (!room) return;
    const nextSlots = generateSlots(rackDraft);
    const existingSlots = cageSlots.filter((slot) => slot.rackId === rackDraft.id);
    const positions = new Set(nextSlots.map(slotKey));
    const oldPositions = new Set(existingSlots.map(slotKey));
    const slotCreates = nextSlots.filter((slot) => !oldPositions.has(slotKey(slot)));
    const slotDeletes = existingSlots.filter((slot) => !positions.has(slotKey(slot))).map((slot) => slot.id);
    const roomRacks = cageRacks.filter((rack) => rack.roomId === room.id);
    await save.mutateAsync(
      existing
        ? { rackUpdates: [rackDraft], slots: slotCreates, slotDeletes }
        : {
            racks: [rackDraft],
            slots: nextSlots,
            roomUpdates: [{ ...room, rackCount: roomRacks.length + 1 } as CageRoom],
          },
    );
    setRackDraft(null);
  }
  async function confirmDelete() {
    if (!deleteTarget) return;
    if (deleteTarget.kind === "room") await removeRoom.mutateAsync(deleteTarget.id);
    else {
      const rack = cageRacks.find((item) => item.id === deleteTarget.id);
      const room = visibleRooms.find((item) => item.id === rack?.roomId);
      const count = cageRacks.filter((item) => item.roomId === room?.id).length;
      await save.mutateAsync({
        rackDeletes: [deleteTarget.id],
        roomUpdates: room ? [{ ...room, rackCount: Math.max(count - 1, 0) } as CageRoom] : [],
      });
    }
    setDeleteTarget(null);
  }
  return (
    <section className="workspace-view settings-workspace">
      <WorkspaceHeader
        kicker="基础设施工作台"
        title="房间管理"
        breadcrumbs={[breadcrumb("系统设置", () => navigate("rooms"))]}
        summary="维护饲养间、笼架和笼位规模，供笼位录入与饲养费核算共同使用。"
        status={canManageRooms ? "系统管理员可维护" : "当前账号可维护授权笼架"}
        switcherLabel="系统功能"
        switcherItems={settingsSwitchItems(navigate, user.role === "admin")}
        actions={
          <div className="workspace-head-button-row">
            {canManageRooms ? (
              <button className="secondary" type="button" onClick={() => setRoomDraft(newRoomDraft())}>
                新增饲养间
              </button>
            ) : null}
            <button
              className="primary"
              type="button"
              disabled={!visibleRooms.length}
              onClick={() => setRackDraft(newRackDraft(visibleRooms[0], cageRacks))}
            >
              新增笼架
            </button>
          </div>
        }
      />
      <div className="workspace-body settings-workspace-body">
        <section className="panel large">
          <div className="panel-head">
            <div className="panel-title-line">
              <h2>饲养间与笼架</h2>
            </div>
            <div className="panel-head-actions">
              <span className="panel-summary-chip">
                {visibleRooms.length} 间 · {cageRacks.length} 架 · {cageSlots.length} 笼位
              </span>
            </div>
          </div>
          <div className="room-list react-room-list">
            {visibleRooms.map((room) => {
              const roomRacks = cageRacks.filter((rack) => rack.roomId === room.id);
              return (
                <article className="room-card" key={room.id}>
                  <div className="room-card-head">
                    <div>
                      <strong>{room.name}</strong>
                      <span>
                        {room.area || "未设置区域"} · {facilityLabel(room.facility)}
                      </span>
                    </div>
                    <div className="table-actions">
                      {canManageRooms ? (
                        <button className="ghost" type="button" onClick={() => setRoomDraft({ ...room })}>
                          编辑房间
                        </button>
                      ) : null}
                      {canManageRooms && visibleRooms.length > 1 ? (
                        <button
                          className="ghost danger-text"
                          type="button"
                          onClick={() => setDeleteTarget({ kind: "room", id: room.id, label: room.name })}
                        >
                          删除
                        </button>
                      ) : null}
                    </div>
                  </div>
                  <div className="rack-tree">
                    {roomRacks.length ? (
                      roomRacks.map((rack) => (
                        <div className="rack-tree-item" key={rack.id}>
                          <div>
                            <strong>笼架 {rack.index}</strong>
                            <span>
                              {rack.rows} 行 × {rack.cols} 列 ·{" "}
                              {cageSlots.filter((slot) => slot.rackId === rack.id).length} 笼位
                            </span>
                          </div>
                          <div className="table-actions">
                            <button className="ghost" type="button" onClick={() => setRackDraft({ ...rack })}>
                              编辑
                            </button>
                            <button
                              className="ghost danger-text"
                              type="button"
                              onClick={() =>
                                setDeleteTarget({ kind: "rack", id: rack.id, label: `${room.name} 笼架 ${rack.index}` })
                              }
                            >
                              删除
                            </button>
                          </div>
                        </div>
                      ))
                    ) : (
                      <div className="empty-state compact">
                        <p>当前房间尚未创建笼架。</p>
                      </div>
                    )}
                  </div>
                  <button
                    className="secondary room-add-rack"
                    type="button"
                    onClick={() => setRackDraft(newRackDraft(room, cageRacks))}
                  >
                    在此房间新增笼架
                  </button>
                </article>
              );
            })}
          </div>
        </section>
      </div>
      {roomDraft ? (
        <RoomEditor
          draft={roomDraft}
          pending={save.isPending}
          onChange={setRoomDraft}
          onClose={() => setRoomDraft(null)}
          onSave={() => void persistRoom()}
        />
      ) : null}
      {rackDraft ? (
        <RackEditor
          draft={rackDraft}
          rooms={visibleRooms}
          pending={save.isPending}
          onChange={setRackDraft}
          onClose={() => setRackDraft(null)}
          onSave={() => void persistRack()}
        />
      ) : null}
      {deleteTarget ? (
        <ConfirmDialog
          title={`删除${deleteTarget.kind === "room" ? "饲养间" : "笼架"}`}
          message={`确认删除“${deleteTarget.label}”？关联笼位将同步移除，占用历史继续保留。`}
          confirmLabel="确认删除"
          danger
          pending={save.isPending || removeRoom.isPending}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => void confirmDelete()}
        />
      ) : null}
    </section>
  );
}
