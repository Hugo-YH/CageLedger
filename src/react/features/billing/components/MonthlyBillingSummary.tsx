import { useState } from "react";
import { Alert, Button, Card, Flex, Form, Input, Space, Tag, Typography } from "antd";
import { FileExcelOutlined } from "@ant-design/icons";

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
    <Card
      className="monthly-billing-summary-card"
      title={
        <Space size={8}>
          <FileExcelOutlined />
          <Typography.Title level={2} style={{ margin: 0 }}>
            月度饲养费汇总
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
        <Flex className="monthly-summary-controls" align="end" gap={16} wrap>
          <Form layout="vertical">
            <Form.Item htmlFor="monthly-billing-month" label="结算月份">
              <Input
                id="monthly-billing-month"
                type="month"
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </Form.Item>
          </Form>
          <Button
            icon={<FileExcelOutlined aria-hidden />}
            loading={exporting}
            disabled={!month}
            type="primary"
            onClick={() => void exportWorkbook()}
          >
            导出月度汇总 Excel
          </Button>
        </Flex>
      </div>
      <Typography.Paragraph className="monthly-summary-hint" type="secondary">
        伦理经费和实验日期来自 IACUC 索引；报销单经费本号与单号优先使用已登记台账。
      </Typography.Paragraph>
      {notice ? <Alert role="status" showIcon type="success" message={notice} /> : null}
    </Card>
  );
}
