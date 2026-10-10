import { Alert, Button, Form, Space, Typography } from "antd";
import dayjs from "dayjs";
import { useState } from "react";

import { useExportIntakeSummary } from "../../../api/intake";
import { ActionIcon } from "../../../components/ui/ActionIcon";
import { DateInput, Dialog } from "../../../components/ui";

export function IntakeSummaryExport() {
  const [open, setOpen] = useState(false);
  const [startDate, setStartDate] = useState(() => dayjs().format("YYYY-MM-DD"));
  const [endDate, setEndDate] = useState(() => dayjs().format("YYYY-MM-DD"));
  const exportSummary = useExportIntakeSummary();
  const invalid = !startDate || !endDate || startDate > endDate;
  const close = () => {
    if (!exportSummary.isPending) setOpen(false);
  };
  return (
    <>
      <Button
        icon={<ActionIcon name="download" />}
        onClick={() => {
          exportSummary.reset();
          setOpen(true);
        }}
      >
        导出汇总
      </Button>
      <Dialog
        open={open}
        title="接收汇总"
        width={560}
        onClose={close}
        footer={
          <Space>
            <Button disabled={exportSummary.isPending} onClick={close}>
              取消
            </Button>
            <Button
              type="primary"
              icon={<ActionIcon name="download" />}
              disabled={invalid}
              loading={exportSummary.isPending}
              onClick={() => exportSummary.mutate({ startDate, endDate })}
            >
              导出 Word
            </Button>
          </Space>
        }
      >
        <Form layout="vertical" disabled={exportSummary.isPending}>
          <Form.Item label="开始日期" htmlFor="intake-summary-start">
            <DateInput
              id="intake-summary-start"
              label="开始日期"
              value={startDate}
              onChange={(value) => {
                setStartDate(value);
                exportSummary.reset();
              }}
              required
            />
          </Form.Item>
          <Form.Item
            label="结束日期"
            htmlFor="intake-summary-end"
            validateStatus={startDate > endDate ? "error" : undefined}
            help={startDate > endDate ? "结束日期不能早于开始日期" : undefined}
          >
            <DateInput
              id="intake-summary-end"
              label="结束日期"
              value={endDate}
              onChange={(value) => {
                setEndDate(value);
                exportSummary.reset();
              }}
              required
            />
          </Form.Item>
          <Typography.Paragraph type="secondary">
            按预约接收日期导出，包含开始和结束当天的全部批次（含草稿、已接收），不受当前表格筛选或勾选影响。
            按日期、房间分组，保留预约明细及笼卡打印、接收状态。
          </Typography.Paragraph>
          {exportSummary.isError ? (
            <Alert role="alert" showIcon type="error" title={exportSummary.error.message} />
          ) : null}
          {exportSummary.isSuccess ? (
            <Alert role="status" showIcon type="success" title={`已下载 ${exportSummary.data}`} />
          ) : null}
        </Form>
      </Dialog>
    </>
  );
}
