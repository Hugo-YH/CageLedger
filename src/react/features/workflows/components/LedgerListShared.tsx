import { useState } from "react";
import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button, Spin, Typography } from "antd";

import type { LedgerListParams } from "../../../api/reimbursementLedger";
import { useLedgerFilterOptions } from "../../../api/reimbursementLedger";
import { FilterableColumnTitle, type TableFilterOption } from "../../../components/FilterableTableHeader";

export function QueryFeedback({
  loading,
  error,
  loadingText,
  errorText,
  retry,
}: {
  loading: boolean;
  error: boolean;
  loadingText: string;
  errorText: string;
  retry: () => void;
}) {
  if (loading) {
    return (
      <div className="ledger-loading" role="status">
        <Spin size="small" />
        <Typography.Text type="secondary">{loadingText}</Typography.Text>
      </div>
    );
  }
  if (error) {
    return (
      <Alert
        action={
          <Button icon={<ReloadOutlined />} size="small" onClick={retry}>
            重试
          </Button>
        }
        showIcon
        title={errorText}
        type="error"
      />
    );
  }
  return null;
}

export function LedgerColumnTitle({
  path,
  params,
  column,
  label,
  values,
  filterable = true,
  localOptions,
  labelMap,
  onSort,
  onFilter,
}: {
  path?: string;
  params: LedgerListParams;
  column: string;
  label: string;
  values: string[];
  filterable?: boolean;
  localOptions?: TableFilterOption[];
  labelMap?: Record<string, string>;
  onSort: () => void;
  onFilter: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const optionsQuery = useLedgerFilterOptions(path ?? "", params, column, open && !localOptions && Boolean(path));
  const serverOptions = (optionsQuery.data?.items || []).map((option) => ({
    ...option,
    label: labelMap?.[option.value] ?? option.label,
  }));
  const options = localOptions ?? serverOptions;
  return (
    <FilterableColumnTitle
      filterable={filterable}
      label={label}
      loading={optionsQuery.isFetching}
      options={options}
      values={values}
      onFilter={onFilter}
      onOpenChange={setOpen}
      onSort={onSort}
    />
  );
}
