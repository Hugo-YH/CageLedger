import { ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Space, Tag, Typography, Upload } from "antd";

import type { ResearcherImportResult, ResearcherImportRow } from "../../../contracts/researchers";
import { DataTable, Modal } from "../../components/ui";
import { useUnsavedChanges } from "../../hooks/useUnsavedChanges";
import { displayResearcherValue } from "./researcherFields";
import { useResearcherImportFlow } from "./useResearcherImportFlow";

const ACTIONS: Record<ResearcherImportRow["action"], string> = {
  create: "新增",
  update: "更新",
  unchanged: "未变",
  invalid: "错误",
};

export function ResearcherImportDialog({
  onClose,
  onImported,
}: {
  onClose: () => void;
  onImported: (result: ResearcherImportResult) => void;
}) {
  const flow = useResearcherImportFlow(onImported);
  const confirmLeave = useUnsavedChanges(Boolean(flow.fileName), flow.importing);
  async function close() {
    if (!(await confirmLeave())) return;
    flow.invalidate();
    onClose();
  }
  return (
    <Modal
      open
      title="导入实验人员信息"
      className="researcher-import-dialog"
      width="min(1120px, calc(100vw - 32px))"
      onCancel={() => void close()}
      footer={
        <Space wrap>
          <Button disabled={flow.importing} onClick={() => void close()}>
            关闭
          </Button>
          <Button
            icon={<ReloadOutlined aria-hidden />}
            disabled={!flow.file || flow.importing || flow.previewing}
            onClick={() => void flow.repreview()}
          >
            重新预览
          </Button>
          <Button
            aria-label="确认导入"
            aria-busy={flow.importing}
            type="primary"
            disabled={!flow.canConfirm || flow.importing}
            loading={flow.importing}
            onClick={() => void flow.confirmImport()}
          >
            确认导入
          </Button>
        </Space>
      }
    >
      <Space orientation="vertical" size="middle" className="researcher-dialog-content">
        <Alert
          showIcon
          type="info"
          title="选择文件后先预览，确认后才写入通讯录"
          description="仅支持不超过 10 MiB 的 .xlsx 文件。按账号更新；空白字段保留原值，不删除文件中未出现的人员。同名或同手机号的不同账号分别保留；导入不会创建系统登录账号。"
        />
        <Upload
          accept=".xlsx"
          disabled={flow.importing}
          showUploadList={false}
          beforeUpload={(file) => {
            void flow.chooseFile(file);
            return false;
          }}
        >
          <Button
            aria-label="选择 Excel 文件"
            aria-busy={flow.previewing}
            loading={flow.previewing}
            disabled={flow.importing}
            icon={<UploadOutlined aria-hidden />}
          >
            选择 Excel 文件
          </Button>
        </Upload>
        {flow.fileName ? <Typography.Text>已选择：{flow.fileName}</Typography.Text> : null}
        {flow.error ? <Alert showIcon type="error" title="导入尚未完成" description={flow.error} /> : null}
        {flow.preview ? (
          <>
            <Space wrap aria-label="导入预览统计">
              <Typography.Text>共 {flow.preview.total} 行</Typography.Text>
              <Tag color="success">新增 {flow.preview.counts.created}</Tag>
              <Tag color="processing">更新 {flow.preview.counts.updated}</Tag>
              <Tag>未变 {flow.preview.counts.unchanged}</Tag>
              <Tag color={flow.preview.counts.invalid ? "error" : "default"}>错误 {flow.preview.counts.invalid}</Tag>
            </Space>
            {flow.preview.counts.invalid > 0 ? (
              <Alert showIcon type="error" title="存在错误行，请修正源文件后重新选择，当前文件不能导入" />
            ) : null}
            <DataTable<ResearcherImportRow>
              rowKey={(row) => `${row.sheet}:${row.row}`}
              dataSource={flow.preview.rows}
              pagination={{ pageSize: 10, showSizeChanger: false }}
              columns={[
                { title: "工作表", dataIndex: "sheet", width: 160 },
                { title: "行号", dataIndex: "row", width: 80 },
                { title: "账号", dataIndex: "account", width: 160 },
                { title: "姓名", dataIndex: "name", width: 140 },
                {
                  title: "结果",
                  dataIndex: "action",
                  width: 90,
                  render: (value: ResearcherImportRow["action"]) => ACTIONS[value],
                },
                {
                  title: "核对事项",
                  key: "issues",
                  width: 240,
                  render: (_, row) => [...row.errors, ...row.warnings].join("；") || "—",
                },
              ]}
              expandable={{
                expandedRowRender: (row) => (
                  <Space orientation="vertical" className="researcher-row-details">
                    {row.changes.map((change) => (
                      <Typography.Text key={change.field}>
                        {change.label}：{displayResearcherValue(change.before)} → {displayResearcherValue(change.after)}
                      </Typography.Text>
                    ))}
                    {row.warnings.map((warning, index) => (
                      <Typography.Text key={`warning-${index}`} type="warning">
                        提示：{warning}
                      </Typography.Text>
                    ))}
                    {row.errors.map((error, index) => (
                      <Typography.Text key={`error-${index}`} type="danger">
                        错误：{error}
                      </Typography.Text>
                    ))}
                    {!row.changes.length && !row.warnings.length && !row.errors.length ? (
                      <Typography.Text type="secondary">无字段变化</Typography.Text>
                    ) : null}
                  </Space>
                ),
              }}
            />
          </>
        ) : null}
      </Space>
    </Modal>
  );
}
