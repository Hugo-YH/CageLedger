import { formatPersonNames } from "../../../../domain/personNames";
import { ActionIcon } from "../../../components/ui/ActionIcon";
import { Alert, Empty, Tag } from "antd";
import type { PlacementTask } from "../../../api/contracts";
import { useMoveInPlacement } from "../../../api/cages";
import { ModalShell } from "../../../components/WorkspaceUi";
import { ActionButton } from "../../../components/ui";
import { today } from "./cageWorkspaceDate";

export function PlacementDrawer({
  tasks,
  selectedTaskId,
  roomId,
  onSelect,
  onClose,
}: {
  tasks: PlacementTask[];
  selectedTaskId: string;
  roomId: string;
  onSelect: (task: PlacementTask) => void;
  onClose: () => void;
}) {
  const moveIn = useMoveInPlacement(roomId);
  return (
    <ModalShell ariaLabel="待进驻动物" className="placement-react-drawer" width={640} onClose={onClose}>
      <div className="modal-shell-head">
        <div>
          <h2>待进驻动物</h2>
          <p>{tasks.length} 个待处理笼位</p>
        </div>
        <ActionButton aria-label="关闭" onClick={onClose}>
          关闭
        </ActionButton>
      </div>
      <div className="modal-shell-body placement-react-list">
        {moveIn.isError ? (
          <Alert
            role="alert"
            type="error"
            showIcon
            title="正式入驻失败"
            description={
              <>
                {moveIn.error.message}
                <br />
                请核对待进驻任务和笼位状态后，点击「正式入驻」重试。
              </>
            }
          />
        ) : null}
        {tasks.length ? (
          tasks.map((task) => (
            <article key={task.id} className={selectedTaskId === task.id ? "selected" : ""}>
              <div>
                <Tag color={task.status === "pending" ? "default" : "processing"} style={{ marginInlineEnd: 0 }}>
                  {task.status === "pending" ? "待分配" : "已预留"}
                </Tag>
                <strong>{task.batchNo || "未命名批次"}</strong>
                <small>
                  {task.plannedMoveInDate || "-"} · {formatPersonNames(task.pi) || "-"} ·{" "}
                  {formatPersonNames(task.owner) || "-"}
                </small>
              </div>
              {task.status === "pending" ? (
                <ActionButton icon={<ActionIcon name="select" />} tone="primary" onClick={() => onSelect(task)}>
                  选择空笼位
                </ActionButton>
              ) : (
                <ActionButton
                  icon={<ActionIcon name="reserve" />}
                  disabled={moveIn.isPending}
                  loading={moveIn.isPending && moveIn.variables?.taskId === task.id}
                  tone="primary"
                  onClick={() => moveIn.mutate({ taskId: task.id, actualMoveInDate: today })}
                >
                  正式入驻
                </ActionButton>
              )}
            </article>
          ))
        ) : (
          <Empty description="当前房间没有待进驻任务" />
        )}
      </div>
    </ModalShell>
  );
}
