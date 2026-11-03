import { Button, Flex, Input, Typography } from "antd";
import { useState } from "react";

const fields = [
  ["batchNumberSearch", "部分批次编号", "输入编号片段，可混用括号"],
  ["batchNumberIacuc", "编号内 IACUC", "例如 Z2025137"],
  ["batchApprovalDate", "实验需求审批日期", "YYYY-MM-DD"],
  ["batchSequence", "批次序号", "例如 06（也可输入 6）"],
] as const;

export function IntakeNumberFilters({
  filters,
  onFilter,
  loading,
}: {
  filters: Record<string, string[]>;
  onFilter: (key: string, values: string[]) => void;
  loading: boolean;
}) {
  const [draft, setDraft] = useState<Record<string, string>>(() =>
    Object.fromEntries(fields.map(([key]) => [key, filters[key]?.[0] || ""])),
  );
  return (
    <form
      aria-label="批次编号全库查询"
      onSubmit={(event) => {
        event.preventDefault();
        for (const [key] of fields) onFilter(key, draft[key].trim() ? [draft[key].trim()] : []);
      }}
    >
      <Flex gap="small" wrap align="end">
        {fields.map(([key, label, placeholder]) => (
          <label key={key}>
            <Typography.Text>{label}</Typography.Text>
            <Input
              aria-label={label}
              placeholder={placeholder}
              value={draft[key]}
              type={key === "batchApprovalDate" ? "date" : "text"}
              onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))}
            />
          </label>
        ))}
        <Button htmlType="submit" type="primary" loading={loading}>
          查询编号
        </Button>
        <Button
          disabled={loading}
          onClick={() => {
            setDraft(Object.fromEntries(fields.map(([key]) => [key, ""])));
            for (const [key] of fields) onFilter(key, []);
          }}
        >
          清除编号条件
        </Button>
      </Flex>
      <Typography.Paragraph type="secondary">
        查询全部批次；多个条件同时满足。审批日期来自批次编号，不是接收日期。序号不代表已核实的累计批次数。
      </Typography.Paragraph>
    </form>
  );
}
