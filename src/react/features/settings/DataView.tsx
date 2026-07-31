import { useDeferredValue, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { InboxOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Input, Select, Space, Statistic, Table, Typography, Upload } from "antd";
import type { UploadProps } from "antd";
import type { ColumnsType } from "antd/es/table";

import { uploadFile, useIacucStatus, usePrincipalIdentities, useSavePrincipalIdentity } from "../../api/administration";
import type { PrincipalIdentity, SessionUser } from "../../api/contracts";
import { queryKeys } from "../../api/queryKeys";
import { formatDateTime, PageState, WorkspaceHeader } from "../../components/WorkspaceUi";
import type { WorkspaceView } from "../../state/ui";
import { breadcrumb, settingsSwitchItems } from "../shell/workspaceNavigation";

const principalTypeOptions = [
  { value: "independent", label: "独立科研人员" },
  { value: "pi", label: "PI" },
];

export function DataView({ user, navigate }: { user: SessionUser; navigate: (view: WorkspaceView) => void }) {
  const status = useIacucStatus();
  const identities = usePrincipalIdentities();
  const saveIdentity = useSavePrincipalIdentity();
  const queryClient = useQueryClient();
  const [filter, setFilter] = useState("");
  const deferredFilter = useDeferredValue(filter);
  const [notice, setNotice] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [uploading, setUploading] = useState("");
  const rows = (identities.data?.items || []).filter((item) =>
    item.pi.toLocaleLowerCase("zh-CN").includes(deferredFilter.trim().toLocaleLowerCase("zh-CN")),
  );

  async function upload(kind: "iacuc" | "monthly" | "arrears", file?: File) {
    if (!file) return;
    setUploading(kind);
    try {
      const endpoint = kind === "iacuc" ? "/api/iacuc-index/upload" : `/api/reimbursement-records/import-${kind}`;
      const result = await uploadFile<{ count?: number }>(endpoint, file);
      setNotice({ type: "success", message: `${file.name} 已处理，共 ${result.count ?? 0} 条记录。` });
      if (kind === "iacuc") {
        void queryClient.invalidateQueries({ queryKey: queryKeys.iacucStatus });
        void queryClient.invalidateQueries({ queryKey: queryKeys.principalIdentities });
      } else void queryClient.invalidateQueries({ queryKey: queryKeys.reimbursementRoot });
    } catch (error) {
      setNotice({ type: "error", message: error instanceof Error ? error.message : "文件处理失败" });
    } finally {
      setUploading("");
    }
  }

  const columns: ColumnsType<PrincipalIdentity> = [
    { title: "项目负责人", dataIndex: "pi", key: "pi", ellipsis: true },
    {
      title: "负责人身份",
      dataIndex: "principalType",
      key: "principalType",
      width: 220,
      render: (_value, item) => (
        <PrincipalTypeSelect
          item={item}
          disabled={user.role !== "admin"}
          pending={saveIdentity.isPending}
          onSave={(next) => saveIdentity.mutateAsync(next)}
        />
      ),
    },
    { title: "免费笼数/天", dataIndex: "freeCageAllowance", key: "freeCageAllowance", width: 140, align: "right" },
    {
      title: "更新时间",
      dataIndex: "updatedAt",
      key: "updatedAt",
      width: 188,
      render: (value: string) => <Typography.Text type="secondary">{formatDateTime(value)}</Typography.Text>,
    },
  ];

  return (
    <section className="workspace-view settings-workspace">
      <WorkspaceHeader
        kicker="数据治理工作台"
        title="数据管理"
        breadcrumbs={[breadcrumb("系统设置", () => navigate("rooms"))]}
        summary="维护 IACUC 索引、负责人身份和历史报销台账，保障录入与结算自动匹配。"
        status={`${status.data?.count || 0} 条 IACUC`}
        switcherLabel="系统功能"
        switcherItems={settingsSwitchItems(navigate, user.role === "admin")}
      />
      <div className="workspace-body settings-workspace-body">
        {notice ? (
          <Alert closable message={notice.message} showIcon type={notice.type} onClose={() => setNotice(null)} />
        ) : null}
        <section className="settings-split-layout data-settings-layout">
          <Card
            className="settings-data-table-card"
            title="项目负责人身份"
            extra={
              <Input.Search
                allowClear
                aria-label="检索项目负责人"
                onChange={(event) => setFilter(event.target.value)}
                placeholder="检索负责人"
                value={filter}
              />
            }
          >
            <Typography.Paragraph type="secondary">负责人身份决定每日免费笼数额度。</Typography.Paragraph>
            {identities.isPending ? (
              <PageState title="正在加载负责人身份..." />
            ) : identities.isError ? (
              <PageState title="负责人身份加载失败" retry={() => identities.refetch()} />
            ) : (
              <Table
                className="app-data-table"
                columns={columns}
                dataSource={rows}
                locale={{ emptyText: "当前没有匹配的项目负责人。" }}
                pagination={{ pageSize: 12, showSizeChanger: true, showTotal: (total) => `共 ${total} 条` }}
                rowKey="pi"
                scroll={{ x: 760 }}
              />
            )}
          </Card>
          <aside className="settings-side-stack">
            <Card size="small" title="IACUC 索引">
              {status.isPending ? (
                <PageState title="正在读取索引状态..." />
              ) : (
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <Statistic title="已索引记录" value={status.data?.count || 0} suffix="条" />
                  <Typography.Text type="secondary">
                    {status.data?.updatedAt ? `最后更新 ${formatDateTime(status.data.updatedAt)}` : "尚未上传索引"}
                  </Typography.Text>
                  <Typography.Text type="secondary">
                    索引用于自动匹配项目名称、负责人、实验负责人和支撑经费。
                  </Typography.Text>
                </Space>
              )}
              {user.role === "admin" ? (
                <ImportDragger
                  accept=".csv,text/csv"
                  label="上传 IACUC CSV"
                  pending={uploading === "iacuc"}
                  onFile={(file) => void upload("iacuc", file)}
                />
              ) : null}
            </Card>
            {user.role === "admin" ? (
              <Card size="small" title="历史报销台账导入">
                <Space direction="vertical" size={12} style={{ width: "100%" }}>
                  <ImportDragger
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    label="导入月汇总 Excel"
                    pending={uploading === "monthly"}
                    onFile={(file) => void upload("monthly", file)}
                  />
                  <ImportDragger
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    label="导入欠缴汇算 Excel"
                    pending={uploading === "arrears"}
                    onFile={(file) => void upload("arrears", file)}
                  />
                </Space>
              </Card>
            ) : null}
          </aside>
        </section>
      </div>
    </section>
  );
}

function PrincipalTypeSelect({
  item,
  disabled,
  pending,
  onSave,
}: {
  item: PrincipalIdentity;
  disabled: boolean;
  pending: boolean;
  onSave: (item: PrincipalIdentity) => Promise<unknown>;
}) {
  const [type, setType] = useState(item.principalType);
  const allowance = type === "pi" ? 20 : 10;
  return (
    <Space.Compact className="principal-type-action">
      <Select
        aria-label={`${item.pi} 的负责人身份`}
        disabled={disabled}
        onChange={setType}
        options={principalTypeOptions}
        value={type}
      />
      <Button
        disabled={disabled}
        loading={pending}
        onClick={() => void onSave({ ...item, principalType: type, freeCageAllowance: allowance })}
        type="primary"
      >
        保存
      </Button>
    </Space.Compact>
  );
}

function ImportDragger({
  accept,
  label,
  pending,
  onFile,
}: {
  accept: string;
  label: string;
  pending: boolean;
  onFile: (file?: File) => void;
}) {
  const props: UploadProps = {
    accept,
    disabled: pending,
    maxCount: 1,
    showUploadList: false,
    beforeUpload: (file) => {
      onFile(file);
      return Upload.LIST_IGNORE;
    },
  };
  return (
    <Upload.Dragger {...props} className="data-import-dragger">
      <p className="ant-upload-drag-icon">
        <InboxOutlined />
      </p>
      <p className="ant-upload-text">{pending ? "正在处理文件..." : label}</p>
      <p className="ant-upload-hint">点击或拖入文件上传</p>
    </Upload.Dragger>
  );
}
