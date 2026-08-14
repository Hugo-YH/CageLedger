import { useState } from "react";
import { ReloadOutlined } from "@ant-design/icons";
import { Alert, Button } from "antd";

import { useColumnFilterOptions } from "../../../api/filterOptions";
import type { LedgerListParams } from "../../../api/reimbursementLedger";
import { FilterableColumnTitle, type TableFilterOption } from "../../../components/FilterableTableHeader";
import { PageSkeleton } from "../../../components/WorkspaceUi";

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
    return <PageSkeleton label={loadingText.replace("正在", "").replace("...", "")} rows={5} variant="table" />;
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
  list,
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
  list?: string;
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
  const optionsQuery = useColumnFilterOptions(
    list ?? "",
    column,
    params.columnFilters,
    open && !localOptions && Boolean(list),
  );
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
