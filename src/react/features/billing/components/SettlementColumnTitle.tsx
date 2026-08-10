import { useState } from "react";

import type { SettlementCandidateListParams } from "../../../api/contracts";
import { useColumnFilterOptions } from "../../../api/filterOptions";
import { FilterableColumnTitle } from "../../../components/FilterableTableHeader";

export function SettlementColumnTitle({
  column,
  label,
  params,
  values,
  onSort,
  onFilter,
}: {
  column: string;
  label: string;
  params: SettlementCandidateListParams;
  values: string[];
  onSort: () => void;
  onFilter: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const options = useColumnFilterOptions("settlement-candidates", column, params.columnFilters, open);
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
