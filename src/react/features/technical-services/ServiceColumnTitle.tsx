import { useState } from "react";

import { FilterableColumnTitle } from "../../components/FilterableTableHeader";
import { useServiceFilterOptions, type ServiceListParams } from "../../api/technicalServices";

export function ServiceColumnTitle({
  list,
  params,
  column,
  label,
  onFilter,
  onSort,
}: {
  list: "sheets" | "settlement-candidates";
  params: ServiceListParams;
  column: string;
  label: string;
  onFilter: (values: string[]) => void;
  onSort: () => void;
}) {
  const [open, setOpen] = useState(false);
  const options = useServiceFilterOptions(list, params, column, open);
  return (
    <FilterableColumnTitle
      label={label}
      dateHierarchy={column === "month" ? "month" : undefined}
      values={params.columnFilters?.[column] || []}
      options={options.data?.items || []}
      loading={options.isFetching}
      error={options.isError ? "无法读取筛选选项，请重试" : undefined}
      onRetry={() => void options.refetch()}
      onOpenChange={setOpen}
      onSort={onSort}
      onFilter={onFilter}
    />
  );
}
