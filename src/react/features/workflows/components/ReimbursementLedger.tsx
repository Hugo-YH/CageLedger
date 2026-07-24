import { useEffect, useState } from "react";

import {
  useConfirmReimbursementAllocation,
  useCreateReimbursementAllocation,
  useLegacyReimbursements,
  useMigrateLegacyReimbursement,
  useReimbursementClaim,
  useReimbursementClaims,
  useReverseReimbursementAllocation,
  useSettlementObligations,
} from "../../../api/reimbursementLedger";
import type { SessionUser } from "../../../api/contracts";
import { AsyncActionButton, formatMoney, ModalShell, PageState } from "../../../components/WorkspaceUi";

const PAGE = { limit: 20, offset: 0 };
const claimStatusLabels: Record<string, string> = {
  pending_submission: "待提交",
  reimbursing: "报销中",
  completed: "已完成",
  void: "已作废",
};

export function ObligationsPanel() {
  const [month, setMonth] = useState("");
  const [sourcePi, setSourcePi] = useState("");
  const query = useSettlementObligations({ ...PAGE, month, sourcePi });
  const items = query.data?.items || [];
  return (
    <section className="ledger-section" aria-label="结算应收列表">
      <div className="command-bar">
        <div className="command-bar-filters">
          <input aria-label="结算月份" type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          <input
            aria-label="费用产生项目负责人"
            type="search"
            value={sourcePi}
            onChange={(event) => setSourcePi(event.target.value)}
            placeholder="费用产生项目负责人"
          />
        </div>
        <span className="list-summary">{query.data?.page.total || 0} 笔应收</span>
      </div>
      {query.isPending ? <PageState title="正在同步结算应收..." /> : null}
      {query.isError ? <PageState title="结算应收加载失败" retry={() => query.refetch()} /> : null}
      {!query.isPending && !query.isError ? (
        <div className="table-wrap" role="region" tabIndex={0} aria-label="结算应收表">
          <table className="dense-table reimbursement-table">
            <thead>
              <tr>
                <th>结算月份</th>
                <th>费用产生项目负责人</th>
                <th>IACUC</th>
                <th>应缴</th>
                <th>已核销</th>
                <th>待核销</th>
                <th>关联报销单</th>
                <th>状态</th>
              </tr>
            </thead>
            <tbody>
              {items.length ? (
                items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.month}</td>
                    <td>{item.sourcePi}</td>
                    <td>
                      {item.iacuc}
                      {item.obligationKind === "adjustment" ? <span className="pill warning">调整</span> : null}
                    </td>
                    <td>{formatMoney(item.payableAmount)}</td>
                    <td>{formatMoney(item.allocatedAmount)}</td>
                    <td>{formatMoney(item.outstandingAmount)}</td>
                    <td>{item.claimCount}</td>
                    <td>
                      <span className={`pill ${item.status}`}>{item.status === "settled" ? "已核销" : "待核销"}</span>
                    </td>
                  </tr>
                ))
              ) : (
                <EmptyRow colSpan={8} text="当前没有可结算应收。生成饲养费结算单后会自动同步到这里。" />
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function ClaimsPanel({ user, onOpen }: { user: SessionUser; onOpen: (id: string) => void }) {
  const [keyword, setKeyword] = useState("");
  const [status, setStatus] = useState("all");
  const query = useReimbursementClaims({ ...PAGE, keyword, status });
  const items = query.data?.items || [];
  return (
    <section className="ledger-section" aria-label="报销单列表">
      <div className="command-bar">
        <div className="command-bar-filters">
          <input
            aria-label="检索报销单"
            type="search"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
            placeholder="检索报销单号或经费负责人"
          />
          <select aria-label="报销单状态" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="all">全部状态</option>
            {Object.entries(claimStatusLabels).map(([value, label]) => (
              <option value={value} key={value}>
                {label}
              </option>
            ))}
          </select>
        </div>
        <span className="list-summary">{query.data?.page.total || 0} 张报销单</span>
      </div>
      {query.isPending ? <PageState title="正在加载报销单..." /> : null}
      {query.isError ? <PageState title="报销单加载失败" retry={() => query.refetch()} /> : null}
      {!query.isPending && !query.isError ? (
        <div className="table-wrap" role="region" tabIndex={0} aria-label="报销单表">
          <table className="dense-table reimbursement-table">
            <thead>
              <tr>
                <th>报销单号</th>
                <th>经费负责人</th>
                <th>经费明细</th>
                <th>报销总额</th>
                <th>已分摊</th>
                <th>未分摊</th>
                <th>附件</th>
                <th>状态</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody>
              {items.length ? (
                items.map((item) => (
                  <tr key={item.id}>
                    <td>{item.documentNumber}</td>
                    <td>{item.fundingOwner}</td>
                    <td>{item.fundingLineCount ?? item.fundingLines?.length ?? "-"}</td>
                    <td>{formatMoney(item.totalAmount)}</td>
                    <td>{formatMoney(item.allocatedAmount)}</td>
                    <td>{formatMoney(item.unallocatedAmount)}</td>
                    <td>{item.attachmentCount}</td>
                    <td>
                      <span className={`pill ${item.status}`}>{claimStatusLabels[item.status]}</span>
                    </td>
                    <td>
                      <button className="secondary compact" type="button" onClick={() => onOpen(item.id)}>
                        详情
                      </button>
                    </td>
                  </tr>
                ))
              ) : (
                <EmptyRow colSpan={9} text={user.role === "admin" ? "尚未创建报销单。" : "尚未创建本人报销单。"} />
              )}
            </tbody>
          </table>
        </div>
      ) : null}
    </section>
  );
}

export function ReconciliationPanel({ user, onOpenClaim }: { user: SessionUser; onOpenClaim: (id: string) => void }) {
  const claims = useReimbursementClaims({ ...PAGE, status: "all" });
  const obligations = useSettlementObligations({ ...PAGE });
  const [claimId, setClaimId] = useState("");
  const [lineId, setLineId] = useState("");
  const [obligationId, setObligationId] = useState("");
  const [amount, setAmount] = useState("");
  const detail = useReimbursementClaim(claimId);
  const create = useCreateReimbursementAllocation();
  const confirm = useConfirmReimbursementAllocation();
  const reverse = useReverseReimbursementAllocation();
  const [reverseTarget, setReverseTarget] = useState("");
  const [reverseReason, setReverseReason] = useState("");
  const selected = detail.data?.item;
  const lines = selected?.fundingLines || [];
  const selectedLine = lines.find((line) => line.id === lineId);
  const allocations = lines.flatMap((line) => line.allocations || []);
  useEffect(() => setLineId(""), [claimId]);
  return (
    <section className="ledger-section reconciliation-section" aria-label="核销中心">
      <div className="reconciliation-picker">
        <label>
          报销单
          <select value={claimId} onChange={(event) => setClaimId(event.target.value)}>
            <option value="">请选择报销单</option>
            {(claims.data?.items || []).map((claim) => (
              <option value={claim.id} key={claim.id}>
                {claim.documentNumber} · {claim.fundingOwner}
              </option>
            ))}
          </select>
        </label>
        <label>
          经费明细
          <select value={lineId} disabled={!selected} onChange={(event) => setLineId(event.target.value)}>
            <option value="">请选择经费本号</option>
            {lines.map((line) => (
              <option value={line.id} key={line.id}>
                {line.fundBookNo} · 可用 {formatMoney(line.unallocatedAmount)}
              </option>
            ))}
          </select>
        </label>
        <label>
          结算应收
          <select value={obligationId} onChange={(event) => setObligationId(event.target.value)}>
            <option value="">请选择结算应收</option>
            {(obligations.data?.items || [])
              .filter((item) => item.outstandingAmount > 0)
              .map((item) => (
                <option value={item.id} key={item.id}>
                  {item.month} · {item.sourcePi} · {item.iacuc} · 待核销 {formatMoney(item.outstandingAmount)}
                </option>
              ))}
          </select>
        </label>
        <label>
          本次金额
          <input
            inputMode="decimal"
            type="number"
            min="0"
            step="0.01"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            placeholder={selectedLine ? String(selectedLine.unallocatedAmount) : "0.00"}
          />
        </label>
        <AsyncActionButton
          className="primary"
          type="button"
          pending={create.isPending}
          pendingLabel="创建中..."
          disabled={!claimId || !lineId || !obligationId}
          onClick={() =>
            void create
              .mutateAsync({ claimId, fundingLineId: lineId, obligationId, amount: Number(amount) })
              .then(() => {
                setAmount("");
                void detail.refetch();
              })
          }
        >
          创建草稿
        </AsyncActionButton>
      </div>
      {selected ? (
        <div className="reconciliation-context">
          <strong>费用产生项目负责人</strong>
          <span>将在每条分摊中显示</span>
          <button className="secondary compact" type="button" onClick={() => onOpenClaim(selected.id)}>
            编辑报销单
          </button>
        </div>
      ) : null}
      <div className="table-wrap" role="region" tabIndex={0} aria-label="核销分摊表">
        <table className="dense-table reimbursement-table">
          <thead>
            <tr>
              <th>费用产生负责人</th>
              <th>报销经费负责人</th>
              <th>IACUC</th>
              <th>经费本号</th>
              <th>本次金额</th>
              <th>状态</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {allocations.length ? (
              allocations.map((item) => (
                <tr key={item.id}>
                  <td>{item.sourcePi}</td>
                  <td>{item.fundingOwner}</td>
                  <td>{item.iacuc}</td>
                  <td>{item.fundBookNo}</td>
                  <td>{formatMoney(item.amount)}</td>
                  <td>
                    <span className={`pill ${item.status}`}>
                      {item.status === "draft" ? "草稿" : item.status === "confirmed" ? "已确认" : "已撤销"}
                    </span>
                  </td>
                  <td>
                    {user.role === "admin" && item.status === "draft" ? (
                      <AsyncActionButton
                        className="secondary compact"
                        type="button"
                        pending={confirm.isPending}
                        pendingLabel="确认中..."
                        onClick={() => void confirm.mutateAsync(item.id).then(() => void detail.refetch())}
                      >
                        确认
                      </AsyncActionButton>
                    ) : null}
                    {user.role === "admin" && item.status === "confirmed" ? (
                      <button
                        className="ghost danger-text compact"
                        type="button"
                        onClick={() => setReverseTarget(item.id)}
                      >
                        撤销
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={7} text="选择报销单后可创建与查看核销分摊。" />
            )}
          </tbody>
        </table>
      </div>
      {reverseTarget ? (
        <ModalShell ariaLabel="撤销核销" className="reimbursement-reverse-dialog" onClose={() => setReverseTarget("")}>
          <div className="modal-shell-head">
            <h2>撤销核销</h2>
          </div>
          <div className="modal-shell-body">
            <p>撤销后会恢复经费明细与结算应收余额。</p>
            <label>
              撤销原因
              <textarea rows={3} value={reverseReason} onChange={(event) => setReverseReason(event.target.value)} />
            </label>
          </div>
          <div className="modal-shell-actions">
            <button className="secondary" type="button" onClick={() => setReverseTarget("")}>
              取消
            </button>
            <AsyncActionButton
              className="danger"
              type="button"
              pending={reverse.isPending}
              pendingLabel="撤销中..."
              disabled={!reverseReason.trim()}
              onClick={() =>
                void reverse.mutateAsync({ id: reverseTarget, reason: reverseReason }).then(() => {
                  setReverseTarget("");
                  setReverseReason("");
                  void detail.refetch();
                })
              }
            >
              确认撤销
            </AsyncActionButton>
          </div>
        </ModalShell>
      ) : null}
    </section>
  );
}

export function LegacyPanel({ user }: { user: SessionUser }) {
  const query = useLegacyReimbursements(PAGE);
  const migrate = useMigrateLegacyReimbursement();
  const items = query.data?.items || [];
  return (
    <section className="ledger-section" aria-label="历史台账">
      <p className="ledger-guidance">
        历史台账保留只读展示。具备报销单号、经费本号及匹配结算应收的记录可由管理员迁入新核销体系。
      </p>
      <div className="table-wrap" role="region" tabIndex={0} aria-label="历史台账列表">
        <table className="dense-table reimbursement-table">
          <thead>
            <tr>
              <th>月份</th>
              <th>费用产生负责人</th>
              <th>报销单号</th>
              <th>经费本号</th>
              <th>应缴</th>
              <th>已缴</th>
              <th>迁入</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? (
              items.map((item) => (
                <tr key={String(item.id)}>
                  <td>{String(item.month || "-")}</td>
                  <td>{String(item.pi || "-")}</td>
                  <td>{String(item.reimbursementFormNo || "-")}</td>
                  <td>{String(item.fundBookNo || "-")}</td>
                  <td>{formatMoney(Number(item.payableAmount || 0))}</td>
                  <td>{formatMoney(Number(item.paidAmount || 0))}</td>
                  <td>
                    {user.role === "admin" && item.migrationEligible ? (
                      <button
                        className="secondary compact"
                        type="button"
                        disabled={migrate.isPending}
                        onClick={() => void migrate.mutateAsync(String(item.id))}
                      >
                        迁入
                      </button>
                    ) : (
                      <span className="muted">待核对</span>
                    )}
                  </td>
                </tr>
              ))
            ) : (
              <EmptyRow colSpan={7} text="当前没有历史台账记录。" />
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function EmptyRow({ colSpan, text }: { colSpan: number; text: string }) {
  return (
    <tr>
      <td colSpan={colSpan} className="table-empty">
        {text}
      </td>
    </tr>
  );
}
