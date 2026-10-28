import { useState } from "react";

import { useColumnFilterOptions } from "../../../api/filterOptions";
import { FilterableColumnTitle } from "../../../components/FilterableTableHeader";

export function WorkflowColumnTitle({
  column,
  label,
  values,
  columnFilters,
  onSort,
  onFilter,
}: {
  column: string;
  label: string;
  values: string[];
  columnFilters: Record<string, string[]>;
  onSort: () => void;
  onFilter: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = useColumnFilterOptions("billing-workflows", column, columnFilters, open);
  return (
    <FilterableColumnTitle
      label={label}
      dateHierarchy={column === "month" ? "month" : undefined}
      loading={options.isFetching}
      error={options.isError ? "无法读取筛选选项，请重试" : undefined}
      onRetry={() => void options.refetch()}
      options={options.data?.items || []}
      values={values}
      onFilter={onFilter}
      onOpenChange={setOpen}
      onSort={onSort}
    />
  );
}
