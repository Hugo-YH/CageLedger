import { useState } from "react";

import type {
  BillingStatementResponse,
  SettlementCandidate,
  SettlementCandidateListParams,
} from "../../../api/contracts";
import { useSettlementCandidates } from "../../../api/billing";
import { useGenerateBillingStatement } from "../../../api/quantitySheets";
import { FilterableTableHeader } from "../../../components/FilterableTableHeader";
import { ModalShell, Pager } from "../../../components/WorkspaceUi";
import { openSettlementPrint, settlementStatementHtml } from "../../../print/settlement";

export function SettlementCandidateList({ source }: { source: "quantity_sheet" | "cage_map" }) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState<{
    key: SettlementCandidateListParams["sortKey"];
    dir: "asc" | "desc";
  }>({ key: "month", dir: "desc" });
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [selected, setSelected] = useState<SettlementCandidate | null>(null);
  const [result, setResult] = useState<BillingStatementResponse | null>(null);
  const [notice, setNotice] = useState("");
  const params: SettlementCandidateListParams = {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    sortKey: sort.key,
    sortDir: sort.dir,
    columnFilters: filters,
  };
  const list = useSettlementCandidates(params, source === "quantity_sheet");
  const generate = useGenerateBillingStatement();
  const items = list.data?.items || [];
  const total = list.data?.page.total || 0;
  const pages = Math.max(Math.ceil(total / pageSize), 1);

  async function generateFor(candidate: SettlementCandidate, persist: boolean) {
    try {
      const response = await generate.mutateAsync({
        month: candidate.month,
        pi: candidate.pi,
        sourceType: source,
        persist,
      });
      setSelected(candidate);
      setResult(response);
      setNotice(persist ? "结算流程已创建，可到结算与报销台账继续处理。" : "结算预览已生成。");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "生成结算单失败");
    }
  }

  if (source === "cage_map") {
    return (
      <section className="panel settlement-workbench">
        <div className="empty-state">
          <h2>动态笼位图结算调试中</h2>
          <p>请切换到“数量统计表（录入）”查看项目负责人结算候选列表。</p>
        </div>
      </section>
    );
  }

  return (
    <section className="panel settlement-workbench">
      <div className="panel-head">
        <div className="panel-title-line">
          <h2>项目负责人结算列表</h2>
          <p>同一负责人、同一月份下的多个伦理号自动合表。</p>
        </div>
        <span className="panel-summary-chip">共 {total} 项</span>
      </div>
      {notice ? (
        <div className="react-inline-notice" role="status">
          {notice}
        </div>
      ) : null}
      <div className="list-meta">
        <span>{list.isFetching ? "正在计算结算候选项" : `当前加载 ${items.length} 项`}</span>
        <span>
          第 {page} / {pages} 页
        </span>
      </div>
      <div className="table-wrap settlement-candidate-list" role="region" tabIndex={0} aria-label="项目负责人结算列表">
        <table className="dense-table settlement-candidate-table">
          <colgroup>
            <col className="settlement-col-month" />
            <col className="settlement-col-pi" />
            <col className="settlement-col-iacuc" />
            <col className="settlement-col-amount" />
            <col className="settlement-col-actions" />
          </colgroup>
          <thead>
            <tr>
              {[
                ["month", "结算月份"],
                ["pi", "项目负责人姓名"],
                ["iacuc", "IACUC"],
                ["amount", "金额"],
              ].map(([column, label]) => (
                <FilterableTableHeader
                  key={column}
                  label={label}
                  values={filters[column] || []}
                  options={list.data?.filterOptions[column] || []}
                  loading={list.isFetching}
                  onSort={() => {
                    setSort((current) => ({
                      key: column as SettlementCandidateListParams["sortKey"],
                      dir: current.key === column && current.dir === "asc" ? "desc" : "asc",
                    }));
                    setPage(1);
                  }}
                  onFilter={(values) => {
                    setFilters((current) => ({ ...current, [column]: values }));
                    setPage(1);
                  }}
                />
              ))}
              <th>操作</th>
            </tr>
          </thead>
          <tbody>
            {items.length ? (
              items.map((candidate) => (
                <tr key={candidate.id}>
                  <td>{candidate.month}</td>
                  <td>{candidate.pi}</td>
                  <td title={candidate.iacucs.join("、") || candidate.error || "-"}>
                    {candidate.iacucs.join("、") || "待检查"}
                  </td>
                  <td className="money-cell">
                    {candidate.totalAmount == null ? "-" : `¥${candidate.totalAmount.toFixed(2)}`}
                  </td>
                  <td>
                    <button
                      className="secondary info-button compact"
                      type="button"
                      disabled={generate.isPending || candidate.totalAmount == null}
                      title={candidate.error || undefined}
                      onClick={() => void generateFor(candidate, false)}
                    >
                      预览结算单
                    </button>
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td colSpan={5}>{list.isPending ? "正在加载..." : "当前筛选条件下没有可结算项目。"}</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <Pager
        page={page}
        pages={pages}
        total={total}
        pageSize={pageSize}
        onPage={setPage}
        onPageSize={(value) => {
          setPageSize(value);
          setPage(1);
        }}
      />
      {selected && result ? (
        <ModalShell
          ariaLabel={`${selected.pi} ${selected.month} 结算预览`}
          className="settlement-preview-modal"
          onClose={() => setSelected(null)}
        >
          <div className="modal-shell-head">
            <div>
              <h2>
                {selected.pi} · {selected.month}
              </h2>
              <p>{selected.iacucs.join("、")}</p>
            </div>
            <div className="modal-shell-actions">
              <button className="secondary info-button" type="button" onClick={() => openSettlementPrint(result)}>
                导出结算单 PDF
              </button>
              <button
                className="primary flow-button"
                type="button"
                disabled={generate.isPending}
                onClick={() => void generateFor(selected, true)}
              >
                发起结算流程
              </button>
              <button className="secondary" type="button" onClick={() => setSelected(null)}>
                关闭
              </button>
            </div>
          </div>
          {notice ? (
            <div className="react-inline-notice" role="status">
              {notice}
            </div>
          ) : null}
          <div className="modal-shell-body settlement-preview settlement-document-preview">
            <iframe title="结算单预览" srcDoc={settlementStatementHtml(result, false)} />
          </div>
        </ModalShell>
      ) : null}
    </section>
  );
}
