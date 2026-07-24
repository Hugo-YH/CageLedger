import { useEffect, useState } from "react";

import { uploadFile, usePrincipalIdentities } from "../../../api/administration";
import { useReimbursementClaim, useSaveReimbursementClaim } from "../../../api/reimbursementLedger";
import type { ReimbursementClaim, ReimbursementFundingLine, SessionUser } from "../../../api/contracts";
import { formatMoney, ModalShell, PageState } from "../../../components/WorkspaceUi";

const claimStatusLabels: Record<string, string> = {
  pending_submission: "待提交",
  reimbursing: "报销中",
  completed: "已完成",
  void: "已作废",
};

export function ReimbursementClaimDialog({
  claimId,
  user,
  onClose,
}: {
  claimId: string;
  user: SessionUser;
  onClose: () => void;
}) {
  const save = useSaveReimbursementClaim();
  const identities = usePrincipalIdentities();
  const [draft, setDraft] = useState<ReimbursementClaim>(() => emptyClaim());
  const [uploading, setUploading] = useState(false);
  const effectiveClaimId = claimId || draft.id;
  const detail = useReimbursementClaim(effectiveClaimId);
  useEffect(() => {
    if (detail.data?.item) setDraft(detail.data.item);
  }, [detail.data?.item]);
  const editable = user.role === "admin" || !effectiveClaimId || detail.data?.item.createdBy === user.id;
  const lines = draft.fundingLines || [];
  const updateLine = (index: number, patch: Partial<ReimbursementFundingLine>) =>
    setDraft((current) => ({
      ...current,
      fundingLines: (current.fundingLines || []).map((line, currentIndex) =>
        currentIndex === index ? { ...line, ...patch } : line,
      ),
    }));
  const persist = async () => {
    const response = await save.mutateAsync({
      id: effectiveClaimId || undefined,
      item: { ...draft, fundingLines: lines },
    });
    setDraft(response.item);
  };
  const upload = async (file: File) => {
    if (!effectiveClaimId) return;
    setUploading(true);
    try {
      await uploadFile(`/api/reimbursement-ledger/claims/${encodeURIComponent(effectiveClaimId)}/attachments`, file);
      await detail.refetch();
    } finally {
      setUploading(false);
    }
  };
  return (
    <ModalShell
      ariaLabel={effectiveClaimId ? "报销单详情" : "新建报销单"}
      className="reimbursement-claim-modal"
      onClose={onClose}
    >
      <div className="modal-shell-head">
        <div>
          <span className="modal-kicker">报销单</span>
          <h2>{claimId ? draft.documentNumber || "报销单详情" : "新建报销单"}</h2>
        </div>
        <button className="secondary compact" type="button" onClick={onClose}>
          关闭
        </button>
      </div>
      <div className="modal-shell-body reimbursement-claim-body">
        {detail.isPending && effectiveClaimId ? <PageState title="正在加载报销单..." /> : null}
        <div className="form-grid">
          <label>
            报销单号
            <input
              value={draft.documentNumber}
              disabled={!editable}
              onChange={(event) => setDraft((current) => ({ ...current, documentNumber: event.target.value }))}
            />
          </label>
          <label>
            状态
            <select
              value={draft.status}
              disabled={!editable}
              onChange={(event) =>
                setDraft((current) => ({ ...current, status: event.target.value as ReimbursementClaim["status"] }))
              }
            >
              {Object.entries(claimStatusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
        </div>
        <section className="field-cluster">
          <div className="field-cluster-head">
            <strong>经费明细</strong>
            <span>同一报销单使用同一位经费负责人</span>
          </div>
          <datalist id="reimbursement-funding-owners">
            {(identities.data?.items || []).map((item) => (
              <option value={item.pi} key={item.pi} />
            ))}
          </datalist>
          {lines.map((line, index) => (
            <div className="funding-line-editor" key={line.id || index}>
              <label>
                经费本号
                <input
                  value={line.fundBookNo}
                  disabled={!editable}
                  onChange={(event) => updateLine(index, { fundBookNo: event.target.value })}
                />
              </label>
              <label>
                经费负责人
                <input
                  list="reimbursement-funding-owners"
                  value={line.fundingOwner}
                  disabled={!editable}
                  onChange={(event) => updateLine(index, { fundingOwner: event.target.value })}
                />
              </label>
              <label>
                报销金额
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={line.reimbursementAmount}
                  disabled={!editable}
                  onChange={(event) => updateLine(index, { reimbursementAmount: Number(event.target.value) })}
                />
              </label>
              {editable ? (
                <button
                  className="ghost danger-text compact"
                  type="button"
                  disabled={lines.length === 1}
                  onClick={() =>
                    setDraft((current) => ({
                      ...current,
                      fundingLines: lines.filter((_, currentIndex) => currentIndex !== index),
                    }))
                  }
                >
                  删除
                </button>
              ) : null}
            </div>
          ))}
          {editable ? (
            <button
              className="secondary compact"
              type="button"
              onClick={() =>
                setDraft((current) => ({ ...current, fundingLines: [...(current.fundingLines || []), emptyLine()] }))
              }
            >
              添加经费明细
            </button>
          ) : null}
        </section>
        {effectiveClaimId ? (
          <section className="field-cluster">
            <div className="field-cluster-head">
              <strong>报销单附件</strong>
              <span>PDF、JPEG、PNG；单文件 30 MiB，最多 10 个</span>
            </div>
            {editable ? (
              <input
                aria-label="上传报销单附件"
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                disabled={uploading}
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) void upload(file);
                }}
              />
            ) : null}
            <div className="attachment-list">
              {(detail.data?.item.attachments || []).map((item) => (
                <a
                  key={item.id}
                  href={`/api/reimbursement-ledger/attachments/${encodeURIComponent(item.id)}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {item.originalName}
                  <span>
                    {Math.ceil(item.sizeBytes / 1024)} KiB · OCR{" "}
                    {item.ocrStatus === "disabled" ? "未启用" : item.ocrStatus}
                  </span>
                </a>
              ))}
            </div>
          </section>
        ) : (
          <p className="muted">保存报销单后可上传扫描 PDF 或图片附件。</p>
        )}
        {effectiveClaimId && lines.some((line) => line.allocations?.length) ? (
          <section className="field-cluster">
            <div className="field-cluster-head">
              <strong>核销分摊</strong>
              <span>费用产生负责人和报销经费负责人分别保留</span>
            </div>
            <div className="allocation-summary-list">
              {lines
                .flatMap((line) => line.allocations || [])
                .map((item) => (
                  <div key={item.id}>
                    <strong>{item.sourcePi}</strong>
                    <span>
                      {item.iacuc} · {item.fundBookNo} · {formatMoney(item.amount)}
                    </span>
                    <span className={`pill ${item.status}`}>
                      {item.status === "draft" ? "草稿" : item.status === "confirmed" ? "已确认" : "已撤销"}
                    </span>
                  </div>
                ))}
            </div>
          </section>
        ) : null}
      </div>
      <div className="modal-shell-actions">
        <button className="secondary" type="button" onClick={onClose}>
          取消
        </button>
        {editable ? (
          <button className="primary" type="button" disabled={save.isPending} onClick={() => void persist()}>
            保存报销单
          </button>
        ) : null}
      </div>
    </ModalShell>
  );
}

function emptyLine(): ReimbursementFundingLine {
  return {
    id: "",
    claimId: "",
    fundBookNo: "",
    fundingOwner: "",
    reimbursementAmount: 0,
    allocatedAmount: 0,
    unallocatedAmount: 0,
    sortOrder: 0,
  };
}
function emptyClaim(): ReimbursementClaim {
  return {
    id: "",
    documentNumber: "",
    fundingOwner: "",
    status: "pending_submission",
    totalAmount: 0,
    allocatedAmount: 0,
    unallocatedAmount: 0,
    attachmentCount: 0,
    createdBy: "",
    createdByName: "",
    createdAt: "",
    updatedAt: "",
    fundingLines: [emptyLine()],
  };
}
