import { ActionIcon } from "./ActionIcon";
import { Button, Flex, Segmented, Tag, Typography } from "antd";

export type ListDensity = "middle" | "small";

const filterLabels: Record<string, string> = {
  month: "月份",
  pi: "负责人",
  iacuc: "IACUC",
  manager: "登记人员",
  status: "状态",
  workflow: "结算状态",
  amount: "金额",
  totalAmount: "金额",
};

/** Applied filters are visible without reopening a column menu. */
export function ListViewControls({
  filters,
  labels = filterLabels,
  onFiltersChange,
  density,
  onDensity,
  disabled = false,
}: {
  filters: Record<string, string[]>;
  labels?: Record<string, string>;
  onFiltersChange: (filters: Record<string, string[]>) => void;
  density: ListDensity;
  onDensity: (value: ListDensity) => void;
  disabled?: boolean;
}) {
  const applied = Object.entries(filters).filter(([, values]) => values.length);
  return (
    <Flex align="center" justify="space-between" gap={12} wrap className="app-list-view-controls">
      <Flex align="center" gap={8} wrap aria-label="已应用筛选">
        <Typography.Text type="secondary">{applied.length ? "当前筛选" : "全部结果 · 点击列标题筛选"}</Typography.Text>
        {applied.map(([key, values]) => (
          <Tag
            style={{ maxWidth: "100%", whiteSpace: "normal", overflowWrap: "anywhere", marginInlineEnd: 0 }}
            key={key}
            closable={!disabled}
            onClose={() => {
              const next = { ...filters };
              delete next[key];
              onFiltersChange(next);
            }}
          >
            {labels[key] || key}：{values.join("、")}
          </Tag>
        ))}
        {applied.length ? (
          <Button
            icon={<ActionIcon name="clear" />}
            type="link"
            size="small"
            disabled={disabled}
            onClick={() => onFiltersChange({})}
          >
            清除全部筛选
          </Button>
        ) : null}
      </Flex>
      <Segmented
        aria-label="表格密度"
        options={[
          { label: "标准", value: "middle" },
          { label: "紧凑", value: "small" },
        ]}
        value={density}
        onChange={(value) => onDensity(value as ListDensity)}
      />
    </Flex>
  );
}
