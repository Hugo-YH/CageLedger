import { ActionIcon } from "../../components/ui/ActionIcon";
import { Alert, Button, Drawer, Select, Skeleton, Space, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useRef, useState } from "react";

import type { FeedbackImportCandidate, FeedbackImportResult } from "../../../contracts/feedback";
import { useFeedbackImportPreview, useImportFeedback } from "../../api/feedback";
import { DataTable } from "../../components/ui";
import { CommandBar } from "../../components/ui/CommandBar";

import { KIND_LABEL as KIND, STATUS_LABEL as STATUS } from "./feedbackPresentation";

export function FeedbackImportDrawer({ onClose }: { onClose: () => void }) {
  const [state, setState] = useState<"all" | "open" | "closed">("all");
  const [page, setPage] = useState(1);
  const [numbers, setNumbers] = useState<number[]>([]);
  const [selectionRepository, setSelectionRepository] = useState("");
  const [result, setResult] = useState<FeedbackImportResult>();
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState<{ requestId: string; repository: string; numbers: number[] } | null>(null);
  const locked = useRef(false);
  const preview = useFeedbackImportPreview(state, page, true);
  const importing = useImportFeedback();
  const pending = busy || importing.isPending;
  const repository = preview.data?.repository;
  const selectionValid = !numbers.length || selectionRepository === repository;
  const candidates = preview.data?.items || [];
  const columns: ColumnsType<FeedbackImportCandidate> = [
    { title: "工单", dataIndex: "number", width: 90, render: (number: number) => `#${number}` },
    { title: "标题", dataIndex: "title", width: 280 },
    {
      title: "类型 / 模块",
      key: "module",
      width: 180,
      render: (_, item) => (
        <Space orientation="vertical" size={4}>
          <Tag>{KIND[item.kind]}</Tag>
          <span>{item.module}</span>
        </Space>
      ),
    },
    {
      title: "提出人",
      dataIndex: "reporter",
      width: 140,
      render: (_, item) => (
        <>
          <span>{item.reporter || "—"}</span>
          {item.reporterSource === "gitea" && item.reporter ? (
            <Typography.Paragraph type="secondary">Gitea 登记账号</Typography.Paragraph>
          ) : null}
        </>
      ),
    },
    {
      title: "状态 / 导入情况",
      key: "status",
      width: 210,
      render: (_, item) => (
        <Space orientation="vertical" size={4}>
          <span>{STATUS[item.status]}</span>
          {item.reason ? (
            <Typography.Text type="secondary">{item.reason}</Typography.Text>
          ) : (
            <Tag color="blue">可导入</Tag>
          )}
        </Space>
      ),
    },
  ];

  async function submit(retry = false) {
    if (locked.current || !repository || (!retry && (!numbers.length || !selectionValid))) return;
    locked.current = true;
    setBusy(true);
    setError("");
    const body = retry ? request : { requestId: crypto.randomUUID(), repository, numbers: [...numbers] };
    setRequest(body);
    try {
      const response = await importing.mutateAsync(body!);
      setResult(response);
      setNumbers(response.items.filter((item) => item.outcome === "failed").map((item) => item.number));
      setRequest(null);
      void preview.refetch();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "导入失败，请重试");
    } finally {
      locked.current = false;
      setBusy(false);
    }
  }

  function changeScope(next: "all" | "open" | "closed") {
    setNotice(numbers.length ? "范围已变化，已清空选择" : "");
    setState(next);
    setPage(1);
    setNumbers([]);
    setError("");
    setResult(undefined);
    setRequest(null);
  }

  return (
    <Drawer
      open
      destroyOnHidden
      size={1000}
      title="导入 Gitea 历史工单"
      onClose={() => {
        if (!pending) onClose();
      }}
      closable={pending ? { disabled: true } : true}
      keyboard={!pending}
      mask={{ closable: !pending }}
      drawerRender={(node) => (
        <div className="feedback-drawer-render" data-feature="feedback">
          {node}
        </div>
      )}
      footer={
        <Space wrap>
          <Button aria-label="关闭导入窗口" disabled={pending} onClick={onClose}>
            关闭
          </Button>
          <Button
            aria-label={`导入所选（${numbers.length}）`}
            type="primary"
            loading={pending}
            disabled={preview.isFetching || preview.isError || !numbers.length || !selectionValid || Boolean(request)}
            onClick={() => void submit()}
          >
            导入所选（{numbers.length}）
          </Button>
        </Space>
      }
    >
      <div className="feedback-detail">
        <Alert
          showIcon
          type="info"
          title="关联原工单，后续自动同步进展"
          description="每次最多导入 10 条；已关联或已删除的工单不会重复导入。提出人优先取历史记录或标题中的 @姓名；未注明时保留 Gitea 登记账号。仅导入公开评论及截图。"
        />
        <Typography.Text type="secondary">目标仓库：{repository || "正在读取…"}</Typography.Text>
        <CommandBar
          ariaLabel="历史工单导入范围"
          context={
            <Space wrap>
              <Select
                aria-label="工单范围"
                disabled={pending || Boolean(request)}
                value={state}
                onChange={changeScope}
                options={[
                  { value: "all", label: "全部工单" },
                  { value: "open", label: "未关闭" },
                  { value: "closed", label: "已关闭" },
                ]}
              />
              <Typography.Text aria-live="polite">已选 {selectionValid ? numbers.length : 0} 项</Typography.Text>
              <Button
                icon={<ActionIcon name="clear" />}
                disabled={pending || Boolean(request) || !numbers.length}
                onClick={() => setNumbers([])}
              >
                清空选择
              </Button>
            </Space>
          }
          actions={
            <Button
              icon={<ActionIcon name="refresh" />}
              disabled={pending || Boolean(request)}
              loading={preview.isFetching}
              onClick={() => void preview.refetch()}
            >
              刷新工单
            </Button>
          }
        />
        {preview.isError ? (
          <Alert
            showIcon
            type="error"
            title="历史工单读取失败"
            description={preview.error.message}
            action={
              <Button icon={<ActionIcon name="refresh" />} onClick={() => void preview.refetch()}>
                重试读取
              </Button>
            }
          />
        ) : null}
        {!selectionValid ? <Alert showIcon type="warning" title="仓库已变化，请重新选择工单" /> : null}
        {notice ? (
          <Typography.Text role="status" type="secondary">
            {notice}
          </Typography.Text>
        ) : null}
        {error ? (
          <Alert
            showIcon
            type="error"
            title="导入请求未完成"
            description={`${error}；重试会核对原请求，避免重复导入。`}
            action={
              <Button icon={<ActionIcon name="refresh" />} disabled={pending} onClick={() => void submit(true)}>
                重试导入
              </Button>
            }
          />
        ) : null}
        {result ? (
          <section aria-label="导入结果" className="feedback-comments">
            <Typography.Text strong>
              导入 {result.items.filter((item) => item.outcome === "imported").length} 条，跳过{" "}
              {result.items.filter((item) => item.outcome === "skipped").length} 条，失败{" "}
              {result.items.filter((item) => item.outcome === "failed").length} 条
            </Typography.Text>
            {result.items.map((item) => (
              <Typography.Text key={item.number} type={item.outcome === "failed" ? "danger" : "secondary"}>
                #{item.number} · {item.message}
              </Typography.Text>
            ))}
            {result.items.some((item) => item.outcome === "failed") ? (
              <Typography.Text>失败项已保留选择，修复原因后可再次导入。</Typography.Text>
            ) : null}
          </section>
        ) : null}
        {preview.isPending ? (
          <Skeleton active paragraph={{ rows: 6 }} />
        ) : preview.data ? (
          <DataTable
            columns={columns}
            dataSource={candidates}
            rowKey="number"
            pagination={false}
            refreshing={preview.isFetching}
            locale={{ emptyText: "此范围没有工单" }}
            rowSelection={{
              hideSelectAll: true,
              preserveSelectedRowKeys: true,
              selectedRowKeys: selectionValid ? numbers : [],
              onChange: (keys) => {
                setSelectionRepository(repository || "");
                setNumbers(keys.map(Number).slice(0, 10));
              },
              getCheckboxProps: (item) => ({
                disabled:
                  pending ||
                  Boolean(request) ||
                  !item.importable ||
                  (numbers.length >= 10 && !numbers.includes(item.number)),
                "aria-label": `选择工单 #${item.number}`,
              }),
            }}
          />
        ) : null}
        <Space wrap>
          <Button
            disabled={pending || page === 1 || preview.isFetching || Boolean(request)}
            onClick={() => setPage(page - 1)}
          >
            上一页
          </Button>
          <Typography.Text>第 {page} 页</Typography.Text>
          <Button
            disabled={pending || !preview.data?.hasMore || preview.isFetching || Boolean(request)}
            onClick={() => setPage(page + 1)}
          >
            下一页
          </Button>
        </Space>
      </div>
    </Drawer>
  );
}
