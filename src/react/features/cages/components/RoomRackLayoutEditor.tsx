import {
  ArrowDownOutlined,
  ArrowLeftOutlined,
  ArrowRightOutlined,
  ArrowUpOutlined,
  RotateRightOutlined,
} from "@ant-design/icons";
import { Alert, Button, Flex, Tooltip, Typography } from "antd";
import { useMemo, useState } from "react";
import { rackLayoutGridDivisions, rackPlacementFits } from "../../../../domain/rackLayout";
import type { RackPlacement } from "../../../api/contracts";
import { useSaveRoomRackLayout } from "../../../api/infrastructure";
import { ModalShell } from "../../../components/WorkspaceUi";
import { useAsyncFormAction } from "../../../hooks/useAsyncFormAction";
import { useOperationFeedback } from "../../../hooks/useOperationFeedback";
import { useUnsavedChanges } from "../../../hooks/useUnsavedChanges";
import { RoomRackMap, type RoomRackMapData } from "./RoomRackMap";

const directions = [
  { label: "左移一格", column: -1, row: 0, Icon: ArrowLeftOutlined },
  { label: "右移一格", column: 1, row: 0, Icon: ArrowRightOutlined },
  { label: "上移一格", column: 0, row: -1, Icon: ArrowUpOutlined },
  { label: "下移一格", column: 0, row: 1, Icon: ArrowDownOutlined },
];

export function RoomRackLayoutEditor({
  roomId,
  roomName,
  mapData,
  layout,
  updatedAt,
  rackId,
  onClose,
}: {
  roomId: string;
  roomName: string;
  mapData: RoomRackMapData;
  layout: RackPlacement[];
  updatedAt: string;
  rackId: string;
  onClose: () => void;
}) {
  const [baseline] = useState(() => ({ placements: layout, updatedAt }));
  const [placements, setPlacements] = useState(baseline.placements);
  const [selectedRackId, setSelectedRackId] = useState(rackId);
  const [placementError, setPlacementError] = useState("");
  const save = useSaveRoomRackLayout(roomId);
  const action = useAsyncFormAction("笼架布局保存失败，请重试");
  const feedback = useOperationFeedback();
  const dirty = JSON.stringify(placements) !== JSON.stringify(baseline.placements);
  const confirmLeave = useUnsavedChanges(dirty, action.pending);
  const selected = placements.find((placement) => placement.rackId === selectedRackId);
  const racks = useMemo(() => new Map(mapData.racks.map((rack) => [rack.id, rack])), [mapData.racks]);
  const selectedRack = racks.get(selectedRackId);

  function move(placement: RackPlacement) {
    if (action.isPending()) return;
    const current = placements.find((item) => item.rackId === placement.rackId);
    if (!rackPlacementFits(placement, placements, racks)) {
      setPlacementError("该位置超出摆放范围或与其他笼架重叠。");
      return;
    }
    setPlacementError("");
    if (
      current?.column === placement.column &&
      current.row === placement.row &&
      current.rotation === placement.rotation
    )
      return;
    setPlacements(placements.map((item) => (item.rackId === placement.rackId ? placement : item)));
  }

  function close() {
    if (action.isPending()) return;
    void confirmLeave().then((leave) => {
      if (leave && !action.isPending()) onClose();
    });
  }

  return (
    <ModalShell ariaLabel="编辑笼架布局" width={880} busy={action.pending} onClose={close}>
      <div className="modal-shell-head">
        <h2>编辑笼架布局</h2>
        <Button aria-label="关闭" size="small" disabled={action.pending} onClick={close}>
          关闭
        </Button>
      </div>
      <Flex vertical gap={16} className="modal-shell-body cage-room-layout-editor" data-feature="cages">
        <Typography.Text type="secondary">拖动笼架调整位置，也可以选中笼架后逐格移动或旋转。</Typography.Text>
        <Flex align="center" justify="space-between" gap={8} wrap>
          <Typography.Text role="status">
            {selected && selectedRack
              ? `${selectedRack.name} · 第 ${selected.column * rackLayoutGridDivisions + 1} 列 · 第 ${selected.row * rackLayoutGridDivisions + 1} 行 · ${selected.rotation}°`
              : "请选择已布置的笼架"}
          </Typography.Text>
          <Flex gap={8} wrap>
            {directions.map(({ label, column, row, Icon }) => (
              <Tooltip key={label} title={label}>
                <Button
                  aria-label={label}
                  icon={<Icon aria-hidden />}
                  disabled={!selected || action.pending}
                  onClick={() =>
                    selected &&
                    move({
                      ...selected,
                      column: selected.column + column / rackLayoutGridDivisions,
                      row: selected.row + row / rackLayoutGridDivisions,
                    })
                  }
                />
              </Tooltip>
            ))}
            <Button
              icon={<RotateRightOutlined aria-hidden />}
              disabled={!selected || action.pending}
              onClick={() => selected && move({ ...selected, rotation: selected.rotation === 90 ? 0 : 90 })}
            >
              旋转 90°
            </Button>
          </Flex>
        </Flex>
        <RoomRackMap
          {...mapData}
          placements={placements}
          selectedRackId={selectedRackId}
          onSelect={(id) => {
            if (selectedRackId !== id) setPlacementError("");
            setSelectedRackId(id);
          }}
          onMove={move}
          disabled={action.pending}
        />
        {placementError ? <Alert type="warning" showIcon title={placementError} /> : null}
        {action.error ? <Alert role="alert" type="error" showIcon title={action.error} /> : null}
      </Flex>
      <div className="modal-shell-actions">
        <Button disabled={action.pending} onClick={close}>
          取消
        </Button>
        <Button
          type="primary"
          loading={action.pending}
          disabled={action.pending}
          onClick={() => {
            void action.run(
              () => save.mutateAsync({ placements, expectedUpdatedAt: baseline.updatedAt }),
              () => {
                feedback.success("笼架布局已保存", roomName);
                onClose();
              },
            );
          }}
        >
          保存布局
        </Button>
      </div>
    </ModalShell>
  );
}
