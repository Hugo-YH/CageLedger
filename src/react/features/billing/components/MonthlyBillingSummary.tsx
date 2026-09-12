import { useState } from "react";
import { Alert, Button, Card, Form, Space, Tag, Typography } from "antd";
import { FileExcelOutlined } from "@ant-design/icons";

import { exportMonthlyBillingSummary } from "../../../api/billing";
import { CommandBar, DateInput } from "../../../components/ui";

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
      setNotice(error instanceof Error ? error.message : "汇总导出失败");
    } finally {
      setExporting(false);
    }
  }

  return (
    <Card
      className="monthly-billing-summary-card"
      title={
        <Space size={8}>
          <FileExcelOutlined />
          <Typography.Title level={2} style={{ margin: 0 }}>
            汇总导出
          </Typography.Title>
        </Space>
      }
      extra={<Tag color="blue">管理员导出</Tag>}
    >
      <Typography.Paragraph type="secondary">
        按 IACUC 和设施汇总数量统计表的当月费用，供线下报销登记使用。
      </Typography.Paragraph>
      <div className="monthly-billing-summary-action">
        <Alert
          type="info"
          showIcon
          title="导出范围"
          description="包含当月全部可结算数量统计表，保留金额为 0 的有效记录。"
        />
        <CommandBar
          className="monthly-summary-controls"
          ariaLabel="月度结算汇总操作"
          filters={
            <Form className="monthly-summary-form" layout="vertical">
              <Form.Item htmlFor="monthly-billing-month" label="结算月份">
                <DateInput
                  id="monthly-billing-month"
                  label="结算月份"
                  picker="month"
                  value={month}
                  onChange={setMonth}
                />
              </Form.Item>
            </Form>
          }
          primaryAction={
            <Button
              icon={<FileExcelOutlined aria-hidden />}
              loading={exporting}
              disabled={!month}
              type="primary"
              onClick={() => void exportWorkbook()}
            >
              导出月度汇总 Excel
            </Button>
          }
        />
      </div>
      <Typography.Paragraph className="monthly-summary-hint" type="secondary">
        伦理经费和实验日期来自 IACUC 索引；报销单经费本编号、单号、金额与备注仅使用单据跟踪已登记报销单。
      </Typography.Paragraph>
      {notice ? <Alert role="status" showIcon title={notice} type="success" /> : null}
    </Card>
  );
}
