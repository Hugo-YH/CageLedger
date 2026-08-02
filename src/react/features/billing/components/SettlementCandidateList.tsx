import { Alert, Button, Card, Checkbox, Empty, Modal, Space, Tooltip, Typography, type TableProps } from "antd";
import { Pager } from "../../../components/WorkspaceUi";
import {
  DownloadOutlined,
  EyeOutlined,
  FileTextOutlined,
  PlayCircleOutlined,
  PrinterOutlined,
} from "@ant-design/icons";
import { useState } from "react";

import type {
  BillingStatementResponse,
  SettlementCandidate,
  SettlementCandidateListParams,
} from "../../../api/contracts";
import { listAllSettlementCandidates, useSettlementCandidates } from "../../../api/billing";
import { useGenerateBillingStatement } from "../../../api/quantitySheets";
import { FilterableColumnTitle } from "../../../components/FilterableTableHeader";
import { DataTable } from "../../../components/ui";
import { openSettlementPrint, settlementStatementHtml } from "../../../print/settlement";
import { usePdfExport } from "../hooks/usePdfExport";

export function SettlementCandidateList({ source }: { source: "quantity_sheet" | "cage_map" }) {
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
  const items = list.data?.items || [];
  const total = list.data?.page.total || 0;
  const pages = Math.max(Math.ceil(total / pageSize), 1);
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
        { key: "amount", label: "金额", width: 150 },
      ] as const
    ).map(({ key, label, width }) => ({
      key,
      dataIndex: key === "amount" ? "totalAmount" : key,
      width,
      align: key === "amount" ? ("right" as const) : undefined,
      title: (
        <FilterableColumnTitle
          label={label}
          values={filters[key] || []}
          options={list.data?.filterOptions[key] || []}
          loading={list.isFetching}
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
        if (key === "amount") {
          return candidate.totalAmount == null ? "-" : `¥${candidate.totalAmount.toFixed(2)}`;
        }
        return candidate[key];
      },
    })),
    {
      key: "actions",
      title: "操作",
      width: 150,
      render: (_, candidate) => {
        const action = (
          <Button
            icon={<EyeOutlined aria-hidden />}
            loading={generate.isPending}
            size="small"
            disabled={candidate.totalAmount == null}
            onClick={() => void generateFor(candidate, false)}
          >
            预览结算单
          </Button>
        );
        return candidate.error ? <Tooltip title={candidate.error}>{action}</Tooltip> : action;
      },
    },
  ];

  async function generateFor(candidate: SettlementCandidate, persist: boolean) {
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
    } catch (error) {
      showNotice(error instanceof Error ? error.message : "生成结算单失败", "error");
    }
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

  if (source === "cage_map") {
    return (
      <Card className="settlement-candidate-card settlement-candidate-empty">
        <Empty
          description={
            <Space orientation="vertical" size={4}>
              <Typography.Text strong>动态笼位图结算正在调试</Typography.Text>
              <Typography.Text type="secondary">
                请切换到“数量统计表（录入）”查看项目负责人结算候选列表。
              </Typography.Text>
            </Space>
          }
          image={Empty.PRESENTED_IMAGE_SIMPLE}
        />
      </Card>
    );
  }

  return (
    <>
      <Card
        className="settlement-candidate-card"
        title={
          <Space size={8}>
            <FileTextOutlined />
            <Typography.Title level={2} style={{ margin: 0 }}>
              项目负责人结算
            </Typography.Title>
          </Space>
        }
      >
        <Typography.Paragraph className="settlement-card-description" type="secondary">
          同一负责人、同一月份下的多个伦理号自动合表。
        </Typography.Paragraph>
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
            <Button
              icon={<PlayCircleOutlined aria-hidden />}
              loading={batchStarting}
              type="primary"
              disabled={!selectedCandidates.length || selectingAll}
              onClick={() => setBatchConfirmOpen(true)}
            >
              {selectedCandidates.length > 1 ? "批量发起结算" : "发起结算流程"}
            </Button>
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
      </Card>
      <Modal
        cancelButtonProps={{ disabled: batchStarting }}
        cancelText="取消"
        confirmLoading={batchStarting}
        okText={`发起 ${selectedCandidates.length} 个流程`}
        open={batchConfirmOpen}
        title="批量发起结算流程"
        onCancel={() => {
          if (!batchStarting) setBatchConfirmOpen(false);
        }}
        onOk={() => void startSelectedCandidates()}
      >
        <Typography.Paragraph>
          将为已选的 {selectedCandidates.length}{" "}
          个项目负责人结算项创建结算流程。系统会按顺序处理，每项保留独立的结算版本和审计记录。
        </Typography.Paragraph>
      </Modal>
      {selected && result ? (
        <Modal
          className="settlement-preview-modal"
          footer={
            <Space wrap>
              <Button icon={<PrinterOutlined aria-hidden />} onClick={() => openSettlementPrint(result)}>
                打印结算单
              </Button>
              <Button
                icon={<DownloadOutlined aria-hidden />}
                loading={pdfExport.isExporting}
                onClick={() => void exportCandidates([selected])}
              >
                导出 PDF
              </Button>
              <Button
                icon={<PlayCircleOutlined aria-hidden />}
                loading={generate.isPending}
                type="primary"
                onClick={() => void generateFor(selected, true)}
              >
                发起结算流程
              </Button>
              <Button onClick={() => setSelected(null)}>关闭</Button>
            </Space>
          }
          open
          title={`${selected.pi} · ${selected.month}`}
          width={1200}
          onCancel={() => setSelected(null)}
        >
          <Typography.Paragraph type="secondary">{selected.iacucs.join("、")}</Typography.Paragraph>
          {notice ? (
            <Alert
              title={notice}
              role="status"
              showIcon
              type={noticeKind === "error" ? "error" : noticeKind === "success" ? "success" : "info"}
            />
          ) : null}
          <div className="settlement-preview settlement-document-preview">
            <iframe title="结算单预览" srcDoc={settlementStatementHtml(result, false)} />
          </div>
        </Modal>
      ) : null}
    </>
  );
}

function settlementExportProgress(completed = 0, total = 0) {
  return total > 1 ? `正在导出 ${completed}/${total}` : "PDF 正在生成，完成后自动下载。";
}
