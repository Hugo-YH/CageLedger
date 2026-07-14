import { useState } from "react";

import { exportMonthlyBillingSummary } from "../../../api/billing";

const currentMonth = new Date().toISOString().slice(0, 7);

export function MonthlyBillingSummary() {
  const [month, setMonth] = useState(currentMonth);
  const [notice, setNotice] = useState("");
  const [exporting, setExporting] = useState(false);

  async function exportWorkbook() {
    setNotice("");
    setExporting(true);
    try {
      const filename = await exportMonthlyBillingSummary(month);
      setNotice(`${filename} 已开始下载。`);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "月度饲养费汇总导出失败");
    } finally {
      setExporting(false);
    }
  }

  return (
    <section className="panel monthly-billing-summary-panel" aria-labelledby="monthly-billing-summary-title">
      <div className="panel-head">
        <div className="panel-title-line">
          <h2 id="monthly-billing-summary-title">月度饲养费汇总</h2>
          <p>按 IACUC 和设施汇总数量统计表的当月费用，供线下报销登记使用。</p>
        </div>
      </div>
      <div className="monthly-billing-summary-body">
        <div className="monthly-summary-intro">
          <strong>导出范围</strong>
          <span>包含当月全部可结算数量统计表，保留金额为 0 的有效记录。</span>
        </div>
        <label className="monthly-summary-month-field">
          <span>结算月份</span>
          <input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
        </label>
        <button
          className="primary monthly-summary-export"
          type="button"
          disabled={!month || exporting}
          onClick={() => void exportWorkbook()}
        >
          {exporting ? "正在生成 Excel..." : "导出月度汇总 Excel"}
        </button>
      </div>
      <p className="monthly-summary-hint">
        伦理经费和实验日期来自 IACUC 索引；报销单经费本号与单号优先使用已登记台账。
      </p>
      {notice ? (
        <div className="react-inline-notice" role="status" aria-live="polite">
          {notice}
        </div>
      ) : null}
    </section>
  );
}
