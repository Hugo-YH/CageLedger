import { useState } from "react";

import type { FeedbackKind, FeedbackStatus, FeedbackSyncStatus } from "../../../contracts/feedback";
import { useFeedbackFilterOptions } from "../../api/feedback";
import type { FeedbackFilters, FeedbackListColumn } from "../../api/feedback";
import { FilterableColumnTitle } from "../../components/FilterableTableHeader";
import { formatDateTime } from "../../components/WorkspaceUi";
import { KIND_LABEL, STATUS_LABEL, SYNC_LABEL } from "./feedbackPresentation";

export function FeedbackColumnTitle({
  column,
  label,
  filters,
  onFilter,
  onSort,
}: {
  column: FeedbackListColumn;
  label: string;
  filters: FeedbackFilters["columnFilters"];
  onFilter: (values: string[]) => void;
  onSort: () => void;
}) {
  const [open, setOpen] = useState(false);
  const options = useFeedbackFilterOptions(column, filters, open);
  const items = (options.data?.items || []).map((option) => ({
    ...option,
    label:
      column === "kind"
        ? KIND_LABEL[option.value as FeedbackKind] || option.label
        : column === "status"
          ? STATUS_LABEL[option.value as FeedbackStatus] || option.label
          : column === "syncStatus"
            ? SYNC_LABEL[option.value as FeedbackSyncStatus] || option.label
            : column === "createdAt"
              ? formatDateTime(option.value)
              : column === "number"
                ? `#${option.value}`
                : option.label,
  }));
  return (
    <FilterableColumnTitle
      label={label}
      values={filters[column] || []}
      options={items}
      loading={options.isFetching}
      error={options.isError ? options.error.message : undefined}
      onRetry={() => void options.refetch()}
      onOpenChange={setOpen}
      onFilter={onFilter}
      onSort={onSort}
    />
  );
}
