import { Alert, Button, Checkbox, Empty, Popconfirm, Space, Tag, Tooltip, Typography, type TableProps } from "antd";
import { Pager } from "../../../components/WorkspaceUi";
import { DownloadOutlined, EyeOutlined, PlayCircleOutlined, UndoOutlined } from "@ant-design/icons";
import { useState } from "react";

import type {
  BillingStatementResponse,
  SessionUser,
  SettlementCandidate,
  SettlementCandidateListParams,
} from "../../../api/contracts";
import { listAllSettlementCandidates, useSettlementCandidates } from "../../../api/billing";
import { useDeleteBillingWorkflow } from "../../../api/workflows";
import { useGenerateBillingStatement } from "../../../api/quantitySheets";
import { DataTable } from "../../../components/ui";
import { usePdfExport } from "../hooks/usePdfExport";
import { BatchStartConfirmModal } from "./BatchStartConfirmModal";
import { SettlementPreviewModal } from "./SettlementPreviewModal";
import { SettlementColumnTitle } from "./SettlementColumnTitle";
import { SettlementNoticeModal } from "./SettlementNoticeModal";
import { buildSettlementNoticeEmail, type SettlementNoticeEmail } from "../../../../domain/settlementNotice";

export function SettlementCandidateList({
  source,
  user,
}: {
  source: "quantity_sheet" | "cage_map";
  user: SessionUser;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [sort, setSort] = useState<{
    key: SettlementCandidateListParams["sortKey"];
    dir: "asc" | "desc";
  }>({ key: "month", dir: "desc" });
  const [filters, setFilters] = useState<Record<string, string[]>>({});
  const [selectedCandidates, setSelectedCandidates] = useState<SettlementCandidate[]>([]);
  const [selected, setSelected] = useState<SettlementCandidate | null>(null);
  const [result, setResult] = useState<BillingStatementResponse | null>(null);
  const [noticeEmail, setNoticeEmail] = useState<{
    candidate: SettlementCandidate;
    email: SettlementNoticeEmail;
  } | null>(null);
  const [notice, setNotice] = useState("");
  const [noticeKind, setNoticeKind] = useState<"success" | "error" | "info">("info");
  const [batchConfirmOpen, setBatchConfirmOpen] = useState(false);
  const [batchStarting, setBatchStarting] = useState(false);
  const [selectingAll, setSelectingAll] = useState(false);
  const [allFilteredSelected, setAllFilteredSelected] = useState(false);
  const pdfExport = usePdfExport();

  function showNotice(message: string, kind: "success" | "error" | "info" = "info") {
    setNotice(message);
    setNoticeKind(kind);
  }
  const params: SettlementCandidateListParams = {
    limit: pageSize,
    offset: (page - 1) * pageSize,
    sortKey: sort.key,
    sortDir: sort.dir,
    columnFilters: filters,
  };
  const list = useSettlementCandidates(params, source === "quantity_sheet");
  const generate = useGenerateBillingStatement();
  const withdrawWorkflow = useDeleteBillingWorkflow();
  const items = list.data?.items || [];
  const total = list.data?.page.total || 0;
  const pages = Math.max(Math.ceil(total / pageSize), 1);
  async function toggleAllFiltered() {
    if (allFilteredSelected) {
      setSelectedCandidates([]);
      setAllFilteredSelected(false);
      return;
    }
    setSelectingAll(true);
    setAllFilteredSelected(true);
    setNotice("");
    try {
      const candidates = await listAllSettlementCandidates(params);
      setSelectedCandidates(candidates.filter((candidate) => candidate.totalAmount != null));
      setAllFilteredSelected(true);
    } catch (error) {
      setAllFilteredSelected(false);
      showNotice(error instanceof Error ? error.message : "无法读取全部结算项", "error");
    } finally {
      setSelectingAll(false);
    }
  }

  function toggleCandidate(candidate: SettlementCandidate, checked: boolean) {
    setAllFilteredSelected(false);
    setSelectedCandidates((current) =>
      checked
        ? [...current.filter((item) => item.id !== candidate.id), candidate]
        : current.filter((item) => item.id !== candidate.id),
    );
  }

  const columns: TableProps<SettlementCandidate>["columns"] = [
    {
      key: "selection",
      title: (
        <Checkbox
          aria-label="全选当前筛选结果结算项"
          disabled={selectingAll || !total}
          checked={total > 0 && allFilteredSelected}
          onChange={() => void toggleAllFiltered()}
        />
      ),
      width: 40,
      render: (_, candidate) => (
        <Checkbox
          aria-label={`选择 ${candidate.pi} ${candidate.month} 结算项`}
          disabled={candidate.totalAmount == null}
          checked={selectedCandidates.some((item) => item.id === candidate.id)}
          onChange={(event) => toggleCandidate(candidate, event.target.checked)}
        />
      ),
    },
    ...(
      [
        { key: "month", label: "结算月份", width: 120 },
        { key: "pi", label: "项目负责人姓名", width: 160 },
        { key: "iacuc", label: "IACUC", width: 300 },
        { key: "workflow", label: "结算状态", width: 110 },
        { key: "amount", label: "金额", width: 150 },
      ] as const
    ).map(({ key, label, width }) => ({
      key,
      dataIndex: key === "amount" ? "totalAmount" : key,
      width,
      align: key === "amount" ? ("right" as const) : undefined,
      title: (
        <SettlementColumnTitle
          column={key}
          label={label}
          params={params}
          values={filters[key] || []}
          onSort={() => {
            setSort((current) => ({
              key,
              dir: current.key === key && current.dir === "asc" ? "desc" : "asc",
            }));
            setPage(1);
          }}
          onFilter={(values) => {
            setFilters((current) => ({ ...current, [key]: values }));
            setSelectedCandidates([]);
            setAllFilteredSelected(false);
            setPage(1);
          }}
        />
      ),
      render: (_: unknown, candidate: SettlementCandidate) => {
        if (key === "iacuc") {
          const text = candidate.iacucs.join("、") || candidate.error || "待检查";
          return <span title={text}>{candidate.iacucs.join("、") || "待检查"}</span>;
        }
        if (key === "workflow") {
          return candidate.hasWorkflow ? <Tag color="processing">已发起</Tag> : <Tag>未发起</Tag>;
        }
        if (key === "amount") {
          return candidate.totalAmount == null ? "-" : `¥${candidate.totalAmount.toFixed(2)}`;
        }
        return candidate[key];
      },
    })),
    {
      key: "actions",
      title: "操作",
      width: 190,
      render: (_, candidate) => {
        const action = (
          <Space size={4} wrap>
            <Button
              icon={<EyeOutlined aria-hidden />}
              loading={generate.isPending}
              size="small"
              disabled={candidate.totalAmount == null}
              onClick={() => void generateFor(candidate, false)}
            >
              预览结算单
            </Button>
            {candidate.hasWorkflow && candidate.workflowStatus === "statement_generated" ? (
              <Popconfirm
                description="撤回后该负责人本月将回到未发起状态，可重新发起结算。"
                okButtonProps={{ danger: true }}
                okText="撤回"
                title="撤回该结算流程？"
                onConfirm={() => void withdrawFor(candidate)}
              >
                <Button danger icon={<UndoOutlined aria-hidden />} loading={withdrawWorkflow.isPending} size="small">
                  撤回
                </Button>
              </Popconfirm>
            ) : null}
          </Space>
        );
        return candidate.error ? <Tooltip title={candidate.error}>{action}</Tooltip> : action;
      },
    },
  ];

  async function withdrawFor(candidate: SettlementCandidate) {
    if (!candidate.workflowId) return;
    try {
      await withdrawWorkflow.mutateAsync(candidate.workflowId);
      setSelected(null);
      setResult(null);
      showNotice(`${candidate.pi} ${candidate.month} 的结算流程已撤回，可重新发起。`, "success");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "撤回结算流程失败", "error");
    }
  }

  async function generateFor(candidate: SettlementCandidate, persist: boolean): Promise<boolean> {
    try {
      const response = await generate.mutateAsync({
        month: candidate.month,
        pi: candidate.pi,
        sourceType: source,
        persist,
      });
      setSelected(candidate);
      setResult(response);
      showNotice(persist ? "结算流程已创建，可到结算与报销台账继续处理。" : "结算预览已生成。", "success");
      return true;
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "生成结算单失败", "error");
      return false;
    }
  }

  async function prepareNoticeEmail(candidate: SettlementCandidate) {
    try {
      const response = await generate.mutateAsync({
        month: candidate.month,
        pi: candidate.pi,
        sourceType: source,
        persist: false,
      });
      setSelected(candidate);
      setResult(response);
      if (!response.statement) return;
      setNoticeEmail({
        candidate,
        email: buildSettlementNoticeEmail({
          month: response.statement.month,
          totalAmount: response.statement.totalAmount,
          staffName: user.displayName,
          staffPhone: user.phone,
        }),
      });
      showNotice("请复制通知邮件并确认发起结算流程。", "info");
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "生成结算单失败", "error");
    }
  }

  async function confirmNoticeEmail() {
    if (!noticeEmail) return;
    const ok = await generateFor(noticeEmail.candidate, true);
    if (ok) setNoticeEmail(null);
  }

  async function exportCandidates(candidates: SettlementCandidate[]) {
    setNotice("");
    try {
      await pdfExport.exportPdf({
        kind: "billing_statement",
        items: candidates.map((candidate) => ({ month: candidate.month, pi: candidate.pi, sourceType: source })),
      });
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "PDF 导出失败", "error");
    }
  }

  async function startSelectedCandidates() {
    const candidates = selectedCandidates.filter((candidate) => candidate.totalAmount != null);
    if (!candidates.length) return;

    setBatchStarting(true);
    setNotice("");
    const completedIds: string[] = [];
    const failures: string[] = [];

    // Ordered writes prevent competing settlement transactions on shared SQLite deployments.
    for (const candidate of candidates) {
      try {
        await generate.mutateAsync({
          month: candidate.month,
          pi: candidate.pi,
          sourceType: source,
          persist: true,
        });
        completedIds.push(candidate.id);
      } catch (error) {
        const message = error instanceof Error ? error.message : "生成失败";
        failures.push(`${candidate.pi}（${message}）`);
      }
    }

    setSelectedCandidates((current) => current.filter((candidate) => !completedIds.includes(candidate.id)));
    setAllFilteredSelected(false);
    setBatchStarting(false);
    setBatchConfirmOpen(false);
    showNotice(
      failures.length
        ? `已发起 ${completedIds.length} 个结算流程；${failures.length} 个未完成：${failures.join("、")}`
        : `已发起 ${completedIds.length} 个结算流程，可到结算与报销台账继续处理。`,
      failures.length ? "error" : "success",
    );
  }

  if (source === "cage_map") {
    return (
      <Empty
        className="settlement-candidate-empty"
        description={
          <Space orientation="vertical" size={4}>
            <Typography.Text strong>动态笼位图结算正在调试</Typography.Text>
            <Typography.Text type="secondary">请切换到“数量统计表（录入）”查看项目负责人结算候选列表。</Typography.Text>
          </Space>
        }
        image={Empty.PRESENTED_IMAGE_SIMPLE}
      />
    );
  }

  return (
    <>
      {notice || pdfExport.isExporting ? (
        <Alert
          title={notice || settlementExportProgress(pdfExport.job?.completed, pdfExport.job?.total)}
          role="status"
          showIcon
          type={notice ? (noticeKind === "error" ? "error" : noticeKind === "success" ? "success" : "info") : "info"}
        />
      ) : null}
      <div className="settlement-action-bar" aria-label="结算批量操作">
        <Typography.Text type={selectedCandidates.length ? undefined : "secondary"}>
          {selectingAll ? `正在选择全部 ${total} 项` : `已选 ${selectedCandidates.length} 项`}
        </Typography.Text>
        <Space wrap>
          <Button
            icon={<DownloadOutlined aria-hidden />}
            loading={pdfExport.isExporting}
            disabled={!selectedCandidates.length || selectingAll}
            onClick={() => void exportCandidates(selectedCandidates)}
          >
            {selectedCandidates.length > 1 ? "批量导出 PDF" : "导出 PDF"}
          </Button>
          <Tooltip
            title={selectedCandidates.every((item) => item.hasWorkflow) ? "所选结算项均已发起结算流程" : undefined}
          >
            <span>
              <Button
                icon={<PlayCircleOutlined aria-hidden />}
                loading={batchStarting}
                type="primary"
                disabled={
                  !selectedCandidates.length || selectingAll || selectedCandidates.every((item) => item.hasWorkflow)
                }
                onClick={() => setBatchConfirmOpen(true)}
              >
                {selectedCandidates.length > 1 ? "批量发起结算" : "发起结算流程"}
              </Button>
            </span>
          </Tooltip>
        </Space>
      </div>
      <div
        className="ant-table-region settlement-candidate-list"
        role="region"
        tabIndex={0}
        aria-label="项目负责人结算列表"
      >
        <DataTable
          columns={columns}
          dataSource={items}
          loading={list.isPending}
          pagination={false}
          resizeKey="settlement-candidates"
          rowKey="id"
        />
      </div>
      <Pager
        itemLabel="项"
        onPage={setPage}
        onPageSize={(nextSize) => {
          setPageSize(nextSize);
          setPage(1);
        }}
        page={page}
        pageSize={pageSize}
        pages={pages}
        total={total}
      />
      <BatchStartConfirmModal
        count={selectedCandidates.length}
        open={batchConfirmOpen}
        pending={batchStarting}
        onCancel={() => {
          if (!batchStarting) setBatchConfirmOpen(false);
        }}
        onConfirm={() => void startSelectedCandidates()}
      />
      {selected && result ? (
        <SettlementPreviewModal
          generatePending={generate.isPending}
          hasWorkflow={Boolean(selected.hasWorkflow)}
          notice={notice}
          noticeKind={noticeKind}
          pdfExporting={pdfExport.isExporting}
          result={result}
          selected={selected}
          onClose={() => setSelected(null)}
          onExportPdf={() => void exportCandidates([selected])}
          onStartSettlement={() => void prepareNoticeEmail(selected)}
        />
      ) : null}
      {noticeEmail ? (
        <SettlementNoticeModal
          email={noticeEmail.email}
          pending={generate.isPending}
          onCancel={() => setNoticeEmail(null)}
          onConfirm={() => void confirmNoticeEmail()}
        />
      ) : null}
    </>
  );
}

function settlementExportProgress(completed = 0, total = 0) {
  return total > 1 ? `正在导出 ${completed}/${total}` : "PDF 正在生成，完成后自动下载。";
}
