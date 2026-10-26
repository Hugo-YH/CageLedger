import { ActionIcon } from "../../components/ui/ActionIcon";
import { useEffect, useState } from "react";
import { Alert, Button, Card, Empty, Space, Tag, Typography } from "antd";

import { useInfrastructureStructure, useRackSlots } from "../../api/infrastructure";
import type { CageRack, CageRoom, CageSlot, SessionUser } from "../../api/contracts";
import { useDeleteRoom, useSaveInfrastructure } from "../../api/administration";
import { ConfirmDialog, ModalShell, PageSkeleton, PageState, WorkspaceToolbar } from "../../components/WorkspaceUi";
import { ListRefreshStatus, ModalPresence } from "../../components/ui";
import { RackEditor, RoomEditor } from "./components/RoomEditors";
import { facilityLabel, generateSlots, newRackDraft, newRoomDraft, type RoomDraft, slotKey } from "./model";

export function RoomsView({ user }: { user: SessionUser }) {
  const query = useInfrastructureStructure();
  const save = useSaveInfrastructure();
  const removeRoom = useDeleteRoom();
  const [roomDraft, setRoomDraft] = useState<RoomDraft | null>(null);
  const [rackDraft, setRackDraft] = useState<CageRack | null>(null);
  const [rackExisting, setRackExisting] = useState(false);
  const [slotSnapshot, setSlotSnapshot] = useState<{ rackId: string; items: CageSlot[] } | null>(null);
  const rackSlots = useRackSlots(rackExisting ? rackDraft?.id || "" : "");
  const [deleteTarget, setDeleteTarget] = useState<{ kind: "room" | "rack"; id: string; label: string } | null>(null);
  const canManageRooms = user.role === "admin";
  useEffect(() => {
    if (rackExisting && rackDraft && !slotSnapshot && !rackSlots.isFetching && !rackSlots.isError && rackSlots.data) {
      setSlotSnapshot({ rackId: rackDraft.id, items: rackSlots.data.items });
    }
  }, [rackDraft, rackExisting, rackSlots.data, rackSlots.isError, rackSlots.isFetching, slotSnapshot]);
  function openRack(rack: CageRack, existing: boolean) {
    setSlotSnapshot(null);
    setRackExisting(existing);
    setRackDraft(rack);
  }
  function closeRack() {
    setRackDraft(null);
    setSlotSnapshot(null);
    setRackExisting(false);
  }
  if (query.isPending)
    return (
      <section className="workspace-view">
        <WorkspaceToolbar ariaLabel="饲养间与笼架操作" title="饲养间与笼架" />
        <PageSkeleton label="基础设施" variant="detail" />
      </section>
    );
  if (!query.data)
    return (
      <section className="workspace-view">
        <WorkspaceToolbar ariaLabel="饲养间与笼架操作" title="饲养间与笼架" />
        <PageState title="基础设施加载失败" retry={() => query.refetch()} />
      </section>
    );
  const { rooms: visibleRooms, racks: cageRacks, roomSummaries, rackSummaries } = query.data;
  async function persistRoom() {
    if (!roomDraft?.name.trim()) return;
    const exists = visibleRooms.some((room) => room.id === roomDraft.id);
    await save.mutateAsync(exists ? { roomUpdates: [roomDraft] } : { rooms: [roomDraft] });
  }
  async function persistRack() {
    if (!rackDraft?.roomId || rackDraft.rows < 1 || rackDraft.cols < 1) return;
    const existing = rackExisting;
    const room = visibleRooms.find((item) => item.id === rackDraft.roomId);
    if (!room) return;
    const nextSlots = generateSlots(rackDraft);
    if (existing && slotSnapshot?.rackId !== rackDraft.id) throw new Error("笼位尚未加载，请重试后保存");
    const existingSlots = existing ? slotSnapshot!.items : [];
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
  }
  return (
    <section className="workspace-view settings-workspace" data-feature="administration">
      <WorkspaceToolbar
        ariaLabel="饲养间与笼架操作"
        title="饲养间与笼架"
        actions={
          <Button
            icon={<ActionIcon name="create" />}
            disabled={!visibleRooms.length}
            onClick={() => openRack(newRackDraft(visibleRooms[0], cageRacks), false)}
          >
            新增笼架
          </Button>
        }
        primaryAction={
          canManageRooms ? (
            <Button icon={<ActionIcon name="create" />} type="primary" onClick={() => setRoomDraft(newRoomDraft())}>
              新增饲养间
            </Button>
          ) : undefined
        }
      />
      <div className="workspace-body settings-workspace-body">
        <ListRefreshStatus active={query.isFetching} />
        {query.isError ? (
          <Alert
            role="alert"
            showIcon
            type="error"
            title="基础设施更新失败，当前输入已保留"
            action={
              <Button
                icon={<ActionIcon name="refresh" />}
                loading={query.isFetching}
                onClick={() => void query.refetch()}
              >
                重试
              </Button>
            }
          />
        ) : null}
        <Card
          className="settings-rooms-card"
          extra={
            <Tag color="processing">
              {visibleRooms.length} 间 · {cageRacks.length} 架 ·{" "}
              {roomSummaries.reduce((total, room) => total + room.slotCount, 0)} 笼位
            </Tag>
          }
        >
          {visibleRooms.length ? (
            visibleRooms.map((room) => {
              const roomRacks = cageRacks.filter((rack) => rack.roomId === room.id);
              return (
                <Card key={room.id} className="settings-room-card" size="small" style={{ width: "100%" }}>
                  <div className="settings-room-content">
                    <div className="settings-room-header">
                      <div>
                        <Typography.Text strong>{room.name}</Typography.Text>
                        <Typography.Paragraph type="secondary">
                          {room.area || "未设置区域"} · {facilityLabel(room.facility)} · 房间管理员：
                          {room.roomManager || "未设置"}
                        </Typography.Paragraph>
                      </div>
                      <Space>
                        {canManageRooms ? <Button onClick={() => setRoomDraft({ ...room })}>编辑房间</Button> : null}
                        {canManageRooms && visibleRooms.length > 1 ? (
                          <Button
                            danger
                            type="link"
                            onClick={() => setDeleteTarget({ kind: "room", id: room.id, label: room.name })}
                          >
                            删除
                          </Button>
                        ) : null}
                      </Space>
                    </div>
                    <div className="settings-rack-list">
                      {roomRacks.length ? (
                        roomRacks.map((rack) => (
                          <div key={rack.id} className="settings-rack-row">
                            <div>
                              <Typography.Text strong>笼架 {rack.index}</Typography.Text>
                              <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
                                {rack.rows} 行 × {rack.cols} 列 ·{" "}
                                {rackSummaries.find((summary) => summary.rackId === rack.id)?.slotCount ?? 0} 笼位
                              </Typography.Paragraph>
                            </div>
                            <Space>
                              <Button onClick={() => openRack({ ...rack }, true)}>编辑</Button>
                              <Button
                                danger
                                type="link"
                                onClick={() =>
                                  setDeleteTarget({
                                    kind: "rack",
                                    id: rack.id,
                                    label: `${room.name} 笼架 ${rack.index}`,
                                  })
                                }
                              >
                                删除
                              </Button>
                            </Space>
                          </div>
                        ))
                      ) : (
                        <Typography.Text type="secondary">当前房间尚未创建笼架。</Typography.Text>
                      )}
                    </div>
                    <Button block onClick={() => openRack(newRackDraft(room, cageRacks), false)}>
                      在此房间新增笼架
                    </Button>
                  </div>
                </Card>
              );
            })
          ) : (
            <Empty description="当前没有可管理的饲养间。" />
          )}
        </Card>
      </div>
      <ModalPresence>
        {roomDraft ? (
          <RoomEditor
            key={roomDraft.id}
            draft={roomDraft}
            pending={save.isPending}
            onChange={setRoomDraft}
            onClose={() => setRoomDraft(null)}
            onSave={persistRoom}
          />
        ) : null}
      </ModalPresence>
      <ModalPresence>
        {rackDraft && rackExisting && !slotSnapshot ? (
          <ModalShell ariaLabel="编辑笼架" className="settings-editor-modal" onClose={closeRack}>
            <div className="modal-shell-head">
              <h2>编辑笼架</h2>
              <Button onClick={closeRack}>关闭</Button>
            </div>
            <div className="modal-shell-body">
              {rackSlots.isError ? (
                <PageState title="笼位读取失败" retry={() => void rackSlots.refetch()} />
              ) : (
                <PageSkeleton compact label="笼位" variant="detail" />
              )}
            </div>
          </ModalShell>
        ) : rackDraft ? (
          <RackEditor
            key={rackDraft.id}
            draft={rackDraft}
            rooms={visibleRooms}
            pending={save.isPending}
            onChange={setRackDraft}
            onClose={closeRack}
            onSave={persistRack}
          />
        ) : null}
      </ModalPresence>
      <ModalPresence>
        {deleteTarget ? (
          <ConfirmDialog
            key={deleteTarget.id}
            title={`删除${deleteTarget.kind === "room" ? "饲养间" : "笼架"}`}
            message={`确认删除“${deleteTarget.label}”？关联笼位将同步移除，占用历史继续保留。`}
            confirmLabel="确认删除"
            danger
            pending={save.isPending || removeRoom.isPending}
            onCancel={() => setDeleteTarget(null)}
            onConfirm={confirmDelete}
          />
        ) : null}
      </ModalPresence>
    </section>
  );
}
