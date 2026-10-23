import { Checkbox, Tag, Typography, type TableProps } from "antd";
import { FeeTypeTag } from "../../../components/BillingTags";
import { workflowTagColor } from "../../../components/billingTagColors";

import type { SettlementCandidate, SettlementCandidateListParams } from "../../../api/contracts";
import { SettlementCandidateActions } from "./SettlementCandidateActions";
import { SettlementColumnTitle } from "./SettlementColumnTitle";

const candidateWorkflowStatusMeta: Record<string, { label: string }> = {
  statement_generated: { label: "已生成" },
  statement_sent: { label: "已发起" },
  statement_locked: { label: "已归档" },
  statement_archived: { label: "未归档（已登记）" },
};

export interface SettlementColumnsOptions {
  selectedCandidates: SettlementCandidate[];
  allFilteredSelected: boolean;
  selectingAll: boolean;
  disabled?: boolean;
  total: number;
  params: SettlementCandidateListParams;
  filters: Record<string, string[]>;
  onToggleAll: () => void;
  onToggle: (candidate: SettlementCandidate, checked: boolean) => void;
  onSort: (column: NonNullable<SettlementCandidateListParams["sortKey"]>) => void;
  onFilter: (column: string, values: string[]) => void;
}

export function buildSettlementColumns(options: SettlementColumnsOptions): TableProps<SettlementCandidate>["columns"] {
  const {
    selectedCandidates,
    allFilteredSelected,
    selectingAll,
    disabled,
    total,
    params,
    filters,
    onToggleAll,
    onToggle,
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
          disabled={disabled || selectingAll || !total}
          onChange={onToggleAll}
        />
      ),
      width: 40,
      render: (_, candidate) => (
        <Checkbox
          aria-label={`选择 ${candidate.pi} ${candidate.month} 结算项`}
          checked={selectedCandidates.some((item) => item.id === candidate.id)}
          disabled={disabled || candidate.totalAmount == null}
          onChange={(event) => onToggle(candidate, event.target.checked)}
        />
      ),
    },
    ...(
      [
        { key: "month", label: "结算月份", width: 110 },
        { key: "feeType", label: "费用类型", width: 110 },
        { key: "pi", label: "项目负责人姓名", width: 150 },
        { key: "iacuc", label: "IACUC", width: 140 },
        { key: "manager", label: "登记人员", width: 110 },
        { key: "workflow", label: "结算状态", width: 110 },
        { key: "amount", label: "金额", width: 130 },
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
        if (key === "feeType") return <FeeTypeTag feeType={candidate.feeType} />;
        if (key === "iacuc") {
          const text = candidate.iacucs.join("、") || candidate.error || "待检查";
          return (
            <Typography.Paragraph
              style={{ margin: 0 }}
              title={text}
              ellipsis={{ rows: 2, expandable: true, symbol: "展开" }}
            >
              {candidate.iacucs.join("、") || "待检查"}
            </Typography.Paragraph>
          );
        }
        if (key === "manager") return candidate.manager || "-";
        if (key === "workflow") {
          if (!candidate.hasWorkflow) return <Tag>未发起</Tag>;
          const meta = candidateWorkflowStatusMeta[candidate.workflowStatus || ""];
          return (
            <Tag color={workflowTagColor(candidate.workflowStatus || "statement_sent")}>{meta?.label || "已发起"}</Tag>
          );
        }
        if (key === "amount") return candidate.totalAmount == null ? "-" : `¥${candidate.totalAmount.toFixed(2)}`;
        return candidate[key];
      },
    })),
    {
      key: "actions",
      title: "操作",
      fixed: "right" as const,
      width: 144,
      render: (_, candidate) => <SettlementCandidateActions candidate={candidate} disabled={disabled} />,
    },
  ];
}
