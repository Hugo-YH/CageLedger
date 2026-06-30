import { useState } from "react";

import type { BillingStatementResponse } from "../../api/contracts";
import { useGenerateBillingStatement } from "../../api/quantitySheets";
import { openSettlementPrint, settlementStatementHtml } from "../../print/settlement";
import { QuantitySheetView } from "./QuantitySheetView";
import type { SessionUser } from "../../api/contracts";

const currentMonth = new Date().toISOString().slice(0, 7);

export function BillingView({ user }: { user: SessionUser }) {
  const [source, setSource] = useState<"quantity_sheet" | "cage_map">("quantity_sheet");
  return (
    <section className="workspace-view billing-workspace react-billing-view">
      <header className="workspace-head">
        <div className="workspace-head-main">
          <span className="workspace-kicker">财务核算工作台</span>
          <div className="workspace-title-line">
            <h1>饲养费管理</h1>
            <span className="workspace-status-badge">
              当前来源：{source === "quantity_sheet" ? "数量统计表" : "动态笼位图"}
            </span>
          </div>
          <p>统一管理动态笼位图和数量统计表两条结算入口，保持导出单据和流程口径一致。</p>
          <div className="workspace-meta-strip">
            <div className="workspace-meta-card">
              <span>结算月份</span>
              <strong>{currentMonth.replace("-", "年")}月</strong>
            </div>
            <div className="workspace-meta-card success">
              <span>核算入口</span>
              <strong>{source === "quantity_sheet" ? "录入" : "自动"}</strong>
            </div>
          </div>
        </div>
      </header>
      <div className="workspace-body billing-workspace-body">
        <section className="panel billing-guide-panel">
          <div className="panel-head">
            <div className="panel-title-line">
              <h2>核算入口</h2>
            </div>
          </div>
          <div className="billing-guide-grid" role="tablist" aria-label="饲养费核算方式">
            <button
              className={`billing-guide-card ${source === "cage_map" ? "active" : ""}`}
              type="button"
              role="tab"
              aria-selected={source === "cage_map"}
              onClick={() => setSource("cage_map")}
            >
              <strong>动态笼位图（自动）</strong>
              <span>按笼位真实占用时间线核算</span>
            </button>
            <button
              className={`billing-guide-card ${source === "quantity_sheet" ? "active" : ""}`}
              type="button"
              role="tab"
              aria-selected={source === "quantity_sheet"}
              onClick={() => setSource("quantity_sheet")}
            >
              <strong>数量统计表（录入）</strong>
              <span>按月度纸质台账录入核算</span>
            </button>
          </div>
        </section>
        {source === "quantity_sheet" ? (
          <QuantitySheetView user={user} />
        ) : (
          <section className="panel">
            <div className="panel-head">
              <div className="panel-title-line">
                <h2>动态笼位图核算</h2>
                <p>系统按当前笼位占用时间线生成每日费用。</p>
              </div>
            </div>
            <div className="empty-state">
              <h3>选择项目负责人生成结算预览</h3>
              <p>结算工作区会从服务端读取对应月份的完整占用记录。</p>
            </div>
          </section>
        )}
        <SettlementWorkbench source={source} />
      </div>
    </section>
  );
}

function SettlementWorkbench({ source }: { source: "quantity_sheet" | "cage_map" }) {
  const [month, setMonth] = useState(currentMonth);
  const [pi, setPi] = useState("");
  const [result, setResult] = useState<BillingStatementResponse | null>(null);
  const [error, setError] = useState("");
  const generate = useGenerateBillingStatement();
  async function run(persist: boolean) {
    if (!month || !pi.trim()) {
      setError("请填写结算月份和项目负责人。");
      return;
    }
    try {
      const response = await generate.mutateAsync({ month, pi: pi.trim(), sourceType: source, persist });
      setResult(response);
      setError(persist ? "结算流程已创建，可到流程中心继续处理。" : "结算预览已生成。");
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "生成结算单失败");
    }
  }
  return (
    <section className="panel settlement-workbench">
      <div className="panel-head">
        <div className="panel-title-line">
          <h2>按项目负责人结算</h2>
          <p>同一负责人、同一月份下的多个伦理号会自动合表。</p>
        </div>
        <div className="panel-head-actions">
          <button
            className="secondary info-button"
            type="button"
            disabled={!result}
            onClick={() => result && openSettlementPrint(result)}
          >
            导出结算单 PDF
          </button>
          <button
            className="primary flow-button"
            type="button"
            disabled={generate.isPending}
            onClick={() => void run(true)}
          >
            发起结算流程
          </button>
        </div>
      </div>
      <div className="settlement-command">
        <label>
          结算月份
          <input type="month" value={month} max={currentMonth} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <label>
          项目负责人
          <input value={pi} onChange={(event) => setPi(event.target.value)} placeholder="输入负责人姓名" />
        </label>
        <button
          className="secondary info-button"
          type="button"
          disabled={generate.isPending}
          onClick={() => void run(false)}
        >
          生成预览
        </button>
      </div>
      {error ? (
        <div className="react-inline-notice" role="status">
          {error}
        </div>
      ) : null}
      {result ? <StatementPreview result={result} /> : null}
    </section>
  );
}

function StatementPreview({ result }: { result: BillingStatementResponse }) {
  return (
    <div className="settlement-preview settlement-document-preview">
      <iframe title="结算单预览" srcDoc={settlementStatementHtml(result, false)} />
    </div>
  );
}
