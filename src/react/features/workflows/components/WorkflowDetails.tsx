import { useEffect, useState } from "react";

import type { ReimbursementRecord, ReimbursementStatus, SessionUser } from "../../../api/contracts";
import {
  useAdvanceWorkflow,
  useDeleteReimbursement,
  useReimbursement,
  useUpdateReimbursement,
} from "../../../api/workflows";
import { ConfirmDialog, formatDateTime, formatMoney, ModalShell, PageState } from "../../../components/WorkspaceUi";

const statusOptions: Array<[ReimbursementStatus | "all", string]> = [
  ["pending_submission", "待提交"],
  ["reimbursing", "报销中"],
  ["completed", "已完成"],
  ["all", "全部"],
];

export function WorkflowRow({ item, onOpen }: { item: ReimbursementRecord; onOpen: () => void }) {
  return (
    <tr className="workflow-row">
      <td>{item.month}</td>
      <td className="workflow-principal-cell">
        <strong>{item.pi || "-"}</strong>
        <span>{item.iacucs?.join("、") || "-"}</span>
      </td>
      <td>{formatMoney(item.payableAmount)}</td>
      <td className={item.accumulatedUnpaid > 0 ? "danger-text" : ""}>{formatMoney(item.accumulatedUnpaid)}</td>
      <td>
        <span className="pill">{workflowLabel(item.workflowStatus)}</span>
      </td>
      <td>
        <span className={`pill ${item.reimbursementStatus}`}>{statusLabel(item.reimbursementStatus)}</span>
      </td>
      <td>{item.fundBookNo || "-"}</td>
      <td>{item.reimbursementFormNo || "-"}</td>
      <td>{formatDateTime(item.latestEventAt || item.updatedAt)}</td>
      <td>
        <button className="secondary info-button" type="button" onClick={onOpen}>
          查看
        </button>
      </td>
    </tr>
  );
}

export function WorkflowDetail({ id, user, onClose }: { id: string; user: SessionUser; onClose: () => void }) {
  const detail = useReimbursement(id);
  const save = useUpdateReimbursement();
  const remove = useDeleteReimbursement();
  const advance = useAdvanceWorkflow();
  const [draft, setDraft] = useState<Partial<ReimbursementRecord>>({});
  const [confirmDelete, setConfirmDelete] = useState(false);
  useEffect(() => {
    if (detail.data?.item) setDraft(detail.data.item);
  }, [detail.data?.item]);
  const item = detail.data?.item;
  async function persist() {
    if (!item) return;
    await save.mutateAsync({ id, patch: draft, expectedUpdatedAt: item.updatedAt });
  }
  async function advanceTo(toStatus: string) {
    if (!item?.workflowId) return;
    await advance.mutateAsync({ workflowId: item.workflowId, toStatus });
    await detail.refetch();
  }
  return (
    <>
      <ModalShell ariaLabel="报销台账详情" className="workflow-detail-modal" onClose={onClose}>
        <div className="modal-shell-head">
          <div>
            <span className="workspace-kicker">报销台账详情</span>
            <h2>{item ? `${item.month} · ${item.pi}` : "正在加载"}</h2>
          </div>
          <button className="secondary" type="button" onClick={onClose}>
            关闭
          </button>
        </div>
        <div className="modal-shell-body">
          {detail.isPending || !item ? (
            <PageState title="正在加载详情..." />
          ) : (
            <>
              <div className="workflow-detail-summary">
                <div>
                  <span>本月应缴</span>
                  <strong>{formatMoney(item.payableAmount)}</strong>
                </div>
                <div>
                  <span>已缴金额</span>
                  <strong>{formatMoney(item.paidAmount)}</strong>
                </div>
                <div>
                  <span>累计未缴</span>
                  <strong>{formatMoney(item.accumulatedUnpaid)}</strong>
                </div>
                <div>
                  <span>IACUC</span>
                  <strong>{item.iacucs?.join("、") || "-"}</strong>
                </div>
              </div>
              {user.role === "admin" ? (
                <div className="field-cluster">
                  <div className="field-cluster-head">
                    <strong>报销登记</strong>
                    <span>编号和金额将参与状态校验</span>
                  </div>
                  <div className="compact-form-row third">
                    <Field
                      label="经费本号"
                      value={String(draft.fundBookNo || "")}
                      onChange={(value) => setDraft((current) => ({ ...current, fundBookNo: value }))}
                    />
                    <Field
                      label="报销单号"
                      value={String(draft.reimbursementFormNo || "")}
                      onChange={(value) => setDraft((current) => ({ ...current, reimbursementFormNo: value }))}
                    />
                    <Field
                      label="已缴金额"
                      type="number"
                      value={String(draft.paidAmount ?? 0)}
                      onChange={(value) => setDraft((current) => ({ ...current, paidAmount: Number(value) }))}
                    />
                  </div>
                  <div className="compact-form-row half">
                    <label>
                      报销状态
                      <select
                        value={draft.reimbursementStatus || item.reimbursementStatus}
                        onChange={(event) =>
                          setDraft((current) => ({
                            ...current,
                            reimbursementStatus: event.target.value as ReimbursementStatus,
                          }))
                        }
                      >
                        {statusOptions.slice(0, 3).map(([value, label]) => (
                          <option key={value} value={value}>
                            {label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <Field
                      label="已批预算"
                      type="number"
                      value={String(draft.approvedBudget ?? "")}
                      onChange={(value) => setDraft((current) => ({ ...current, approvedBudget: value }))}
                    />
                  </div>
                  <label>
                    备注
                    <textarea
                      rows={3}
                      value={String(draft.notes || "")}
                      onChange={(event) => setDraft((current) => ({ ...current, notes: event.target.value }))}
                    />
                  </label>
                  <div className="form-actions">
                    <button className="primary" type="button" disabled={save.isPending} onClick={() => void persist()}>
                      保存报销登记
                    </button>
                  </div>
                </div>
              ) : null}
              <WorkflowHistory items={detail.data?.history || []} />
              {item.workflowId ? (
                <div className="field-cluster">
                  <div className="field-cluster-head">
                    <strong>结算流程</strong>
                    <span>{workflowLabel(item.workflowStatus)}</span>
                  </div>
                  <div className="workflow-step-actions">
                    {nextWorkflowStatuses(item.workflowStatus).map(([value, label]) => (
                      <button
                        key={value}
                        className="secondary"
                        type="button"
                        disabled={advance.isPending || user.role !== "admin"}
                        onClick={() => void advanceTo(value)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}
            </>
          )}
        </div>
        {user.role === "admin" && item ? (
          <div className="modal-shell-actions">
            <button className="ghost danger-text" type="button" onClick={() => setConfirmDelete(true)}>
              删除台账
            </button>
            <button className="secondary" type="button" onClick={onClose}>
              完成
            </button>
          </div>
        ) : null}
      </ModalShell>
      {confirmDelete ? (
        <ConfirmDialog
          title="删除报销台账"
          message={`确认删除 ${item?.month || ""} ${item?.pi || ""} 的报销台账？`}
          confirmLabel="确认删除"
          danger
          pending={remove.isPending}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={async () => {
            await remove.mutateAsync(id);
            setConfirmDelete(false);
            onClose();
          }}
        />
      ) : null}
    </>
  );
}

function WorkflowHistory({ items }: { items: ReimbursementRecord[] }) {
  return (
    <div className="field-cluster">
      <div className="field-cluster-head">
        <strong>历史滚动</strong>
        <span>{items.length} 个月</span>
      </div>
      <div className="audit-list compact-audit-list">
        {items.map((item) => (
          <div className="audit-row" key={item.id}>
            <div>
              <strong>{item.month}</strong>
              <p>
                应缴 {formatMoney(item.payableAmount)} · 已缴 {formatMoney(item.paidAmount)}
              </p>
            </div>
            <span>累计未缴 {formatMoney(item.accumulatedUnpaid)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
function Field({
  label,
  value,
  onChange,
  type = "text",
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  type?: string;
}) {
  return (
    <label>
      {label}
      <input
        type={type}
        min={type === "number" ? 0 : undefined}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  );
}
function statusLabel(status: ReimbursementStatus) {
  return ({ pending_submission: "待提交", reimbursing: "报销中", completed: "已完成" } as const)[status] || status;
}
function workflowLabel(status: string) {
  return (
    (
      {
        in_feeding: "饲养中",
        statement_generated: "已生成",
        statement_sent: "已发送",
        statement_signed_returned: "已签字交回",
        submitted_to_finance: "已提交财务",
        workflow_deleted: "流程已删除",
      } as Record<string, string>
    )[status] || "未发起"
  );
}
function nextWorkflowStatuses(status: string): Array<[string, string]> {
  const steps: Array<[string, string]> = [
    ["statement_generated", "标记已生成"],
    ["statement_sent", "标记已发送"],
    ["statement_signed_returned", "标记已签字交回"],
    ["submitted_to_finance", "标记已提交财务"],
  ];
  const index = steps.findIndex(([value]) => value === status);
  return index < steps.length - 1 ? [steps[index + 1]] : [];
}
