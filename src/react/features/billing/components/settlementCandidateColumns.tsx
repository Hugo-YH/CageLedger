import { Checkbox, Tag, type TableProps } from "antd";

import type { SettlementCandidate, SettlementCandidateListParams } from "../../../api/contracts";
import { SettlementCandidateActions } from "./SettlementCandidateActions";
import { SettlementColumnTitle } from "./SettlementColumnTitle";

const candidateWorkflowStatusMeta: Record<string, { label: string; color: string }> = {
  statement_generated: { label: "已生成", color: "gold" },
  statement_sent: { label: "已发起", color: "processing" },
  statement_archived: { label: "已归档", color: "green" },
};

export interface SettlementColumnsOptions {
  selectedCandidates: SettlementCandidate[];
  allFilteredSelected: boolean;
  selectingAll: boolean;
  total: number;
  params: SettlementCandidateListParams;
  filters: Record<string, string[]>;
  previewing: boolean;
  onToggleAll: () => void;
  onToggle: (candidate: SettlementCandidate, checked: boolean) => void;
  onPreview: (candidate: SettlementCandidate) => void;
  onSort: (column: string) => void;
  onFilter: (column: string, values: string[]) => void;
}

export function buildSettlementColumns(options: SettlementColumnsOptions): TableProps<SettlementCandidate>["columns"] {
  const {
    selectedCandidates,
    allFilteredSelected,
    selectingAll,
    total,
    params,
    filters,
    previewing,
    onToggleAll,
    onToggle,
    onPreview,
    onSort,
    onFilter,
  } = options;
  return [
    {
      key: "selection",
      title: (
        <Checkbox
          aria-label="全选当前筛选结果结算项"
          checked={total > 0 && allFilteredSelected}
          disabled={selectingAll || !total}
          onChange={onToggleAll}
        />
      ),
      width: 40,
      render: (_, candidate) => (
        <Checkbox
          aria-label={`选择 ${candidate.pi} ${candidate.month} 结算项`}
          checked={selectedCandidates.some((item) => item.id === candidate.id)}
          disabled={candidate.totalAmount == null}
          onChange={(event) => onToggle(candidate, event.target.checked)}
        />
      ),
    },
    ...(
      [
        { key: "month", label: "结算月份", width: 120 },
        { key: "pi", label: "项目负责人姓名", width: 160 },
        { key: "iacuc", label: "IACUC", width: 300 },
        { key: "manager", label: "登记人员", width: 150 },
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
          onFilter={(values) => onFilter(key, values)}
          onSort={() => onSort(key)}
        />
      ),
      render: (_: unknown, candidate: SettlementCandidate) => {
        if (key === "iacuc") {
          const text = candidate.iacucs.join("、") || candidate.error || "待检查";
          return <span title={text}>{candidate.iacucs.join("、") || "待检查"}</span>;
        }
        if (key === "manager") return candidate.manager || "-";
        if (key === "workflow") {
          if (!candidate.hasWorkflow) return <Tag>未发起</Tag>;
          const meta = candidateWorkflowStatusMeta[candidate.workflowStatus || ""];
          return meta ? <Tag color={meta.color}>{meta.label}</Tag> : <Tag color="processing">已发起</Tag>;
        }
        if (key === "amount") return candidate.totalAmount == null ? "-" : `¥${candidate.totalAmount.toFixed(2)}`;
        return candidate[key];
      },
    })),
    {
      key: "actions",
      title: "操作",
      width: 190,
      render: (_, candidate) => (
        <SettlementCandidateActions
          candidate={candidate}
          previewing={previewing}
          onPreview={() => onPreview(candidate)}
        />
      ),
    },
  ];
}
