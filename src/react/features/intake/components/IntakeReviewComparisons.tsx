import { Flex, Radio, Table, Tag, Tooltip, Typography, type TableProps } from "antd";
import { useId, useState } from "react";

import type {
  IntakeBatch,
  IntakeReviewCalculation,
  IntakeReviewCandidate,
  IntakeReviewResolution,
  IntakeReviewResolutions,
} from "../../../../contracts/intake";
import { intakePurposeLabel, speciesLabel } from "../../../../domain/intake";
import { tagColors } from "../../../../theme/visual-system.mjs";
import { ActionButton, HelpPopover } from "../../../components/ui";

type Comparison = IntakeReviewCandidate["comparisons"][number];
const STATUS: Record<Comparison["status"], string> = {
  same: "一致",
  different: "不一致",
  missing: "本次缺失",
  supplement: "可补充",
  unknown: "无法确认",
  calculated: "联动计算",
  retained: "保留原值",
};
const STRATEGY_NOTICES = {
  saved_image_first: {
    title: "以原预约图片信息为主，文字补充空缺",
    description:
      "默认保留原预约图片中的动物信息，本次文字补充空缺；接收日期和饲养周期按“合并后”联动计算，请核对字段取值及计算依据后确认。",
  },
  incoming_image_first: {
    title: "以本次图片信息为主，原预约文字补充空缺",
    description:
      "默认采用本次图片中已确认的动物信息，原预约文字补充图片缺项；接收日期和饲养周期按“合并后”联动计算，确认后更新已保存的预约。",
  },
};

function valueText(value: unknown, field: string) {
  if (value === null || value === undefined || value === "") return "未填写";
  if (field === "intakePurpose" && typeof value === "string") return intakePurposeLabel(value);
  if (field === "species" && typeof value === "string") return speciesLabel(value);
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function SourceValue({ value, field, unconfirmed }: { value: unknown; field: string; unconfirmed?: boolean }) {
  if (!unconfirmed) return valueText(value, field);
  return (
    <Flex vertical gap={2}>
      <Typography.Text>{valueText(value, field)}</Typography.Text>
      <Typography.Text type="secondary">未确认占位</Typography.Text>
    </Flex>
  );
}

function PeriodCalculation({ calculation }: { calculation: IntakeReviewCalculation }) {
  const { basis, periodSource, startDate, endDate, days, months } = calculation;
  const dateDifference = `${endDate} − ${startDate} = ${days} 天`;
  if (basis === "date_range") {
    return <span>由日期区间计算：{dateDifference}</span>;
  }
  const duration = basis === "fixed_days" ? `${days} 天` : months == null ? "自然月周期" : `${months} 个自然月`;
  const source = periodSource === "saved" ? "保留 " : periodSource === "incoming" ? "本次识别 " : "";
  const startLabel = periodSource === "saved" ? "新接收日" : "接收日";
  const endLabel = periodSource === "saved" ? "新结束日" : "结束日";
  return (
    <Flex vertical gap={2}>
      <span>{`${startLabel} ${startDate} + ${source}${duration} = ${endLabel} ${endDate}`}</span>
      <span>按结束日与接收日的日期差：{dateDifference}</span>
    </Flex>
  );
}

function mergedFieldValue(merged: IntakeBatch, field: string) {
  return field === "strainStandard" ? merged.strainStandard || merged.strainRaw : merged[field as keyof IntakeBatch];
}

function MergedValue({ row, merged }: { row: Comparison; merged: IntakeBatch }) {
  return (
    <Typography.Text className="intake-review-merged-value">
      {valueText(mergedFieldValue(merged, row.field), row.field)}
    </Typography.Text>
  );
}

function ComparisonStatus({ row, merged }: { row: Comparison; merged: IntakeBatch | null | undefined }) {
  const tag = (
    <Tag color={tagColors.intakeReview[row.status]} tabIndex={row.calculation ? 0 : undefined}>
      {STATUS[row.status]}
    </Tag>
  );
  if (!row.calculation) return tag;
  return (
    <Tooltip
      trigger={["hover", "focus"]}
      title={
        <Flex vertical gap={4}>
          {merged ? (
            <span>{`原值 ${valueText(row.before, row.field)} → 合并后 ${valueText(mergedFieldValue(merged, row.field), row.field)}`}</span>
          ) : null}
          <PeriodCalculation calculation={row.calculation} />
        </Flex>
      }
    >
      {tag}
    </Tooltip>
  );
}

export function IntakeReviewComparisons({
  candidate,
  labels,
  pending = false,
  blocked = false,
  requestedResolutions,
  onResolve,
}: {
  candidate: IntakeReviewCandidate;
  labels: Readonly<Record<string, string>>;
  pending?: boolean;
  blocked?: boolean;
  requestedResolutions?: IntakeReviewResolutions;
  onResolve?: (field: string, value: IntakeReviewResolution) => void;
}) {
  const detailsId = useId();
  const [expandedCandidates, setExpandedCandidates] = useState(() => new Set<string>());
  const showAll = expandedCandidates.has(candidate.item.id);
  const merged = candidate.canMerge ? candidate.mergedItem : null;
  const notice = candidate.canMerge && candidate.mergeStrategy ? STRATEGY_NOTICES[candidate.mergeStrategy] : null;
  const choosing = Boolean(onResolve && candidate.resolutionFields?.length);
  const reviewRows = candidate.comparisons.filter(
    (row) =>
      row.status !== "same" ||
      row.placeholder?.before ||
      row.placeholder?.incoming ||
      candidate.resolutionFields?.includes(row.field) ||
      requestedResolutions?.[row.field] !== undefined,
  );
  const allSame = candidate.comparisons.length > 0 && reviewRows.length === 0;
  const hasHiddenRows = reviewRows.length < candidate.comparisons.length;
  function selectedResolution(row: Comparison): IntakeReviewResolution | undefined {
    const requested = requestedResolutions?.[row.field];
    if (requested !== undefined) return requested;
    if (row.calculation && merged) {
      const after = mergedFieldValue(merged, row.field);
      if (after === row.before) return "saved";
      if (after === row.incoming) return "incoming";
      return undefined;
    }
    return candidate.resolutions?.[row.field];
  }
  const columns: TableProps<Comparison>["columns"] = [
    { title: "字段", dataIndex: "field", width: 120, render: (field: string) => labels[field] || field },
    {
      title: "原预约",
      dataIndex: "before",
      render: (value: unknown, row) => (
        <SourceValue value={value} field={row.field} unconfirmed={row.placeholder?.before} />
      ),
    },
    {
      title: "本次识别",
      dataIndex: "incoming",
      render: (value: unknown, row) => (
        <SourceValue value={value} field={row.field} unconfirmed={row.placeholder?.incoming} />
      ),
    },
    ...(merged
      ? [
          {
            title: "合并后",
            key: "after",
            className: "intake-review-merged-cell",
            render: (_value: unknown, row: Comparison) => <MergedValue row={row} merged={merged} />,
          },
        ]
      : []),
    {
      title: "核对结果",
      key: "status",
      width: choosing ? 216 : 120,
      render: (_value: unknown, row) => (
        <Flex
          vertical
          align="start"
          gap={4}
          onClickCapture={(event) => {
            const target = event.target;
            const selected = selectedResolution(row);
            if (
              !onResolve ||
              pending ||
              blocked ||
              requestedResolutions?.[row.field] !== undefined ||
              !(target instanceof HTMLInputElement) ||
              target.type !== "radio" ||
              target.value !== selected
            )
              return;
            // A click on a checked default has no change event, but expresses
            // an endpoint choice distinct from automatic date retention.
            onResolve(row.field, target.value);
          }}
        >
          <ComparisonStatus row={row} merged={merged} />
          {onResolve && candidate.resolutionFields?.includes(row.field) ? (
            <Radio.Group
              role="radiogroup"
              aria-label={`${labels[row.field] || row.field}取值`}
              orientation="vertical"
              style={{ maxWidth: "100%", overflowWrap: "anywhere" }}
              disabled={pending || blocked}
              value={selectedResolution(row)}
              options={[
                { label: valueText(row.before, row.field), value: "saved", title: "原预约" },
                { label: valueText(row.incoming, row.field), value: "incoming", title: "本次识别" },
              ]}
              onChange={(event) => onResolve(row.field, event.target.value as IntakeReviewResolution)}
            />
          ) : null}
        </Flex>
      ),
    },
  ];
  return (
    <Flex vertical gap={12} className="intake-review-comparisons" role="region" aria-label="预约字段核对">
      <Flex align="center" justify="space-between" gap={8} wrap className="intake-review-comparison-toolbar">
        <Typography.Text
          className={`intake-review-comparison-summary${allSame ? " intake-review-comparison-matched" : ""}`}
          type={allSame ? "success" : undefined}
          strong
        >
          {allSame
            ? `全部 ${candidate.comparisons.length} 项字段一致`
            : candidate.comparisons.length
              ? `待核对字段（${reviewRows.length}）`
              : "暂无可对比的字段信息"}
        </Typography.Text>
        {hasHiddenRows ? (
          <ActionButton
            size="small"
            aria-expanded={showAll}
            aria-controls={detailsId}
            onClick={() => {
              setExpandedCandidates((current) => {
                const next = new Set(current);
                if (next.has(candidate.item.id)) next.delete(candidate.item.id);
                else next.add(candidate.item.id);
                return next;
              });
            }}
          >
            {showAll
              ? `只看待核对字段（${reviewRows.length}）`
              : `${allSame ? "查看" : "显示"}全部字段（${candidate.comparisons.length}）`}
          </ActionButton>
        ) : null}
      </Flex>
      {notice ? (
        <Flex align="center" gap={6} wrap className="intake-review-strategy-note">
          <Typography.Text type="secondary">{notice.title}</Typography.Text>
          <HelpPopover label="字段合并策略说明">
            <Flex vertical gap={8}>
              <Typography.Text>{notice.description}</Typography.Text>
              {choosing ? <Typography.Text>可在“核对结果”列逐项调整，最终以“合并后”取值为准。</Typography.Text> : null}
            </Flex>
          </HelpPopover>
          {choosing ? <Typography.Text type="secondary">可在核对结果列调整。</Typography.Text> : null}
        </Flex>
      ) : choosing ? (
        <Typography.Text type="secondary" className="intake-review-strategy-note">
          在核对结果列选择各差异字段的取值，再确认合并。
        </Typography.Text>
      ) : null}
      <div id={detailsId}>
        {!allSame || showAll ? (
          <Table
            className="intake-review-comparison-table"
            columns={columns}
            dataSource={showAll ? candidate.comparisons : reviewRows}
            rowKey="field"
            pagination={false}
            scroll={{ x: merged ? (choosing ? 1000 : 850) : choosing ? 850 : 700 }}
            size="small"
          />
        ) : null}
      </div>
    </Flex>
  );
}
