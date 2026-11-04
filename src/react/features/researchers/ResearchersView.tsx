import { ReloadOutlined, SearchOutlined, UploadOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Input, Select, Space, Typography } from "antd";
import { useState } from "react";

import type { Researcher, ResearcherImportResult } from "../../../contracts/researchers";
import type { SessionUser } from "../../api/contracts";
import { useResearchers } from "../../api/researchers";
import { PageSkeleton, PageState, WorkspaceToolbar } from "../../components/WorkspaceUi";
import { DataTable, ModalPresence } from "../../components/ui";
import { useOperationFeedback } from "../../hooks/useOperationFeedback";
import { ResearcherDetailDialog } from "./ResearcherDetailDialog";
import { ResearcherImportDialog } from "./ResearcherImportDialog";

export function ResearchersView({ user }: { user: SessionUser }) {
  const canEdit = user.role === "admin";
  const feedback = useOperationFeedback();
  const [search, setSearch] = useState("");
  const [q, setQ] = useState("");
  const [department, setDepartment] = useState<string | undefined>();
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(20);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);
  const list = useResearchers({ q, department, limit, offset: (page - 1) * limit });
  function imported(result: ResearcherImportResult) {
    const { counts } = result;
    feedback.success(
      "实验人员信息已导入",
      `新增 ${counts.created} 人，更新 ${counts.updated} 人，未变 ${counts.unchanged} 人，错误 ${counts.invalid} 行${result.replayed ? "（已核对同次请求结果）" : ""}`,
    );
    setImportOpen(false);
  }
  function applySearch() {
    setQ(search.trim());
    setPage(1);
  }
  return (
    <section className="workspace-view researchers-workspace" data-feature="researchers">
      <WorkspaceToolbar
        title="实验人员信息"
        ariaLabel="实验人员信息"
        description="独立实验人员通讯录。账号用于识别同一人员，与系统登录账号独立；同名、同手机号的不同账号分别保留。"
        actions={
          <Button
            aria-label="刷新"
            aria-busy={list.isFetching}
            icon={<ReloadOutlined aria-hidden />}
            loading={list.isFetching}
            onClick={() => void list.refetch()}
          >
            刷新
          </Button>
        }
        primaryAction={
          canEdit ? (
            <Button type="primary" icon={<UploadOutlined aria-hidden />} onClick={() => setImportOpen(true)}>
              导入 Excel
            </Button>
          ) : undefined
        }
      />
      <div className="workspace-body researchers-workspace-body">
        <Card className="researchers-list-card">
          <Space wrap className="researchers-filters">
            <Input.Search
              allowClear
              aria-label="搜索实验人员"
              placeholder="姓名、别名、账号、手机或邮箱"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                if (!event.target.value) {
                  setQ("");
                  setPage(1);
                }
              }}
              onSearch={applySearch}
              enterButton={<SearchOutlined aria-label="搜索" />}
            />
            <Select
              aria-label="按部门筛选"
              placeholder="全部部门"
              allowClear
              showSearch
              value={department}
              options={list.data?.departments.map((value) => ({ label: value, value })) ?? []}
              onChange={(value) => {
                setDepartment(value);
                setPage(1);
              }}
            />
            <Typography.Text type="secondary">
              {canEdit ? "管理员可导入和编辑联系方式" : "当前账号可检索、查看人员资料"}
            </Typography.Text>
          </Space>
          {list.isError ? (
            <Alert
              showIcon
              type="error"
              title={list.data ? "列表刷新失败，当前显示上次结果；已完成的保存不受影响" : "实验人员列表加载失败"}
              action={
                <Button icon={<ReloadOutlined aria-hidden />} onClick={() => void list.refetch()}>
                  重试
                </Button>
              }
            />
          ) : null}
          {list.isPending ? (
            <PageSkeleton label="实验人员" variant="table" />
          ) : !list.data ? (
            <PageState title="暂无可用人员资料" />
          ) : (
            <DataTable<Researcher>
              rowKey="id"
              dataSource={list.data.items}
              refreshing={list.isFetching}
              columns={[
                { title: "姓名", dataIndex: "name", width: 130 },
                { title: "账号", dataIndex: "account", width: 180 },
                { title: "别名", dataIndex: "alias", width: 130 },
                { title: "部门", dataIndex: "department", width: 200 },
                { title: "职务", dataIndex: "position", width: 140 },
                { title: "手机", dataIndex: "mobile", width: 150 },
                { title: "邮箱", dataIndex: "email", width: 240 },
                {
                  title: "操作",
                  key: "actions",
                  fixed: "right",
                  width: 100,
                  render: (_, item) => (
                    <Button size="small" onClick={() => setSelectedId(item.id)}>
                      {canEdit ? "查看 / 编辑" : "查看"}
                    </Button>
                  ),
                },
              ]}
              pagination={{
                current: page,
                pageSize: limit,
                total: list.data.page.total,
                showSizeChanger: true,
                showTotal: (total) => `共 ${total} 人`,
                onChange: (nextPage, nextLimit) => {
                  setPage(nextLimit === limit ? nextPage : 1);
                  setLimit(nextLimit);
                },
              }}
              locale={{ emptyText: "暂无匹配的实验人员" }}
            />
          )}
        </Card>
      </div>
      <ModalPresence>
        {selectedId ? (
          <ResearcherDetailDialog
            key={selectedId}
            id={selectedId}
            canEdit={canEdit}
            onClose={() => setSelectedId(null)}
            onSaved={(item) => {
              feedback.success("实验人员资料已保存", `${item.name || item.account} · ${item.account}`);
              setSelectedId(null);
            }}
          />
        ) : null}
      </ModalPresence>
      <ModalPresence>
        {importOpen ? <ResearcherImportDialog onClose={() => setImportOpen(false)} onImported={imported} /> : null}
      </ModalPresence>
    </section>
  );
}
