import { useState } from "react";
import { Alert, Button, Card, Form, Input } from "antd";

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
    <Card className="monthly-billing-summary-panel" size="small" title="月度饲养费汇总">
      <p className="ant-form-extra">按 IACUC 和设施汇总数量统计表的当月费用，供线下报销登记使用。</p>
      <div className="monthly-billing-summary-body">
        <Alert
          className="monthly-summary-intro"
          type="info"
          showIcon
          message="导出范围"
          description="包含当月全部可结算数量统计表，保留金额为 0 的有效记录。"
        />
        <Form layout="vertical" className="monthly-summary-month-field">
          <Form.Item label="结算月份">
            <Input type="month" value={month} onChange={(event) => setMonth(event.target.value)} />
          </Form.Item>
        </Form>
        <Button type="primary" loading={exporting} disabled={!month} onClick={() => void exportWorkbook()}>
          导出月度汇总 Excel
        </Button>
      </div>
      <p className="ant-form-extra monthly-summary-hint">
        伦理经费和实验日期来自 IACUC 索引；报销单经费本号与单号优先使用已登记台账。
      </p>
      {notice ? <Alert className="react-inline-notice" type="info" showIcon message={notice} /> : null}
    </Card>
  );
}
