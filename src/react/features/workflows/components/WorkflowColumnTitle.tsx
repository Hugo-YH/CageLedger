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
      loading={options.isFetching}
      options={options.data?.items || []}
      values={values}
      onFilter={onFilter}
      onOpenChange={setOpen}
      onSort={onSort}
    />
  );
}
