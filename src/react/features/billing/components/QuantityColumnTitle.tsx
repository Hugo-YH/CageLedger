import { useState } from "react";
import type { QuantitySheetListParams } from "../../../api/contracts";
import { useQuantityFilterOptions } from "../../../api/quantitySheets";
import { FilterableColumnTitle } from "../../../components/FilterableTableHeader";

export function QuantityColumnTitle({
  column,
  label,
  params,
  values,
  onSort,
  onFilter,
}: {
  column: string;
  label: string;
  params: QuantitySheetListParams;
  values: string[];
  onSort: () => void;
  onFilter: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = useQuantityFilterOptions(params, column, open);
  return (
    <FilterableColumnTitle
      label={label}
      dateHierarchy={column === "month" ? "month" : column === "updatedAt" ? "datetime" : undefined}
      values={values}
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
