import { Alert, Flex, Radio, Table, Tag, Tooltip, Typography, type TableProps } from "antd";

import type {
  IntakeBatch,
  IntakeReviewCalculation,
  IntakeReviewCandidate,
  IntakeReviewResolution,
  IntakeReviewResolutions,
} from "../../../../contracts/intake";
import { intakePurposeLabel, speciesLabel } from "../../../../domain/intake";
import { tagColors } from "../../../../theme/visual-system.mjs";

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
  return <Typography.Text>{valueText(mergedFieldValue(merged, row.field), row.field)}</Typography.Text>;
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
  const merged = candidate.canMerge ? candidate.mergedItem : null;
  const notice = candidate.canMerge && candidate.mergeStrategy ? STRATEGY_NOTICES[candidate.mergeStrategy] : null;
  const choosing = Boolean(onResolve && candidate.resolutionFields?.length);
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
    <Flex vertical gap={12}>
      {notice ? (
        <Alert
          showIcon
          type="warning"
          title={notice.title}
          description={
            choosing ? `${notice.description} 可在“核对结果”列逐项调整，最终以“合并后”取值为准。` : notice.description
          }
        />
      ) : choosing ? (
        <Alert showIcon type="info" title="在核对结果列选择各差异字段的取值，再确认合并" />
      ) : null}
      <Table
        columns={columns}
        dataSource={candidate.comparisons}
        rowKey="field"
        pagination={false}
        scroll={{ x: merged ? (choosing ? 1000 : 850) : choosing ? 850 : 700 }}
        size="small"
      />
    </Flex>
  );
}
