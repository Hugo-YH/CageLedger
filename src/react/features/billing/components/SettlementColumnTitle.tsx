import { useState } from "react";

import type { SettlementCandidateListParams } from "../../../api/contracts";
import { useSettlementFilterOptions } from "../../../api/settlements";
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
  const options = useSettlementFilterOptions(params, column, open);
  return (
    <FilterableColumnTitle
      label={label}
      loading={options.isFetching}
      error={options.isError ? "无法读取筛选选项" : undefined}
      onRetry={() => void options.refetch()}
      options={options.data?.items || []}
      values={values}
      onFilter={onFilter}
      onOpenChange={setOpen}
      onSort={onSort}
    />
  );
}
