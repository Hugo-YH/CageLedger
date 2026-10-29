import { formatPersonNames } from "../../../../domain/personNames";
import { Table, type TableProps } from "antd";

import type { IntakeDuplicateDetails, IntakeDuplicateItem } from "../../../api/contracts";
import { ActionButton } from "../../../components/ui";
import { ModalShell } from "../../../components/WorkspaceUi";
import { intakeStatusLabel } from "../../../../domain/intake";

export function IntakeDuplicateConfirmDialog({
  details,
  error,
  pending,
  onClose,
  onConfirm,
}: {
  details: IntakeDuplicateDetails;
  error: string;
  pending: boolean;
  onClose: () => void;
  onConfirm: () => void;
}) {
  const items = details.items.slice(0, 20);
  const columns: TableProps<IntakeDuplicateItem>["columns"] = [
    {
      title: "匹配项",
      dataIndex: "matchedFields",
      width: 104,
      render: (fields: IntakeDuplicateItem["matchedFields"]) => fields.map(intakeDuplicateFieldLabel).join("、"),
    },
    { title: "采购单号", dataIndex: "purchaseOrderNo", width: 140, render: (value: string) => value || "-" },
    { title: "批次号", dataIndex: "batchNo", width: 150, render: (value: string) => value || "-" },
    { title: "接收日期", dataIndex: "intakeDate", width: 108, render: (value: string) => value || "待定" },
    { title: "项目负责人", dataIndex: "pi", width: 108, render: (value: string) => formatPersonNames(value) || "-" },
    { title: "实验负责人", dataIndex: "owner", width: 108, render: (value: string) => formatPersonNames(value) || "-" },
    {
      title: "状态",
      dataIndex: "status",
      width: 82,
      render: (value: IntakeDuplicateItem["status"]) => intakeStatusLabel(value),
    },
  ];
  const close = () => {
    if (!pending) onClose();
  };
  return (
    <ModalShell
      ariaLabel="发现重复待接收批次"
      className="intake-duplicate-confirm-modal"
      width="min(1040px, calc(100vw - 32px))"
      onClose={close}
    >
      <div className="modal-shell-head">
        <div>
          <h2>发现可能重复的待接收批次</h2>
          <p>共匹配到 {details.total} 条记录，请核对后决定是否继续保存。</p>
        </div>
        <ActionButton aria-label="关闭" disabled={pending} onClick={close}>
          关闭
        </ActionButton>
      </div>
      <div className="modal-shell-body">
        <p>匹配采购单号或批次号的已有记录如下：</p>
        <Table columns={columns} dataSource={items} pagination={false} rowKey="id" scroll={{ x: 800 }} size="small" />
        {details.total > items.length ? <p>仅展示前 {items.length} 条匹配记录。</p> : null}
        {error ? <p role="alert">{error}</p> : null}
      </div>
      <div className="modal-shell-actions">
        <ActionButton disabled={pending} onClick={close}>
          返回修改
        </ActionButton>
        <ActionButton loading={pending} tone="primary" onClick={onConfirm}>
          仍然保存
        </ActionButton>
      </div>
    </ModalShell>
  );
}

function intakeDuplicateFieldLabel(field: "purchaseOrderNo" | "batchNo") {
  return field === "purchaseOrderNo" ? "采购单号" : "批次号";
}
