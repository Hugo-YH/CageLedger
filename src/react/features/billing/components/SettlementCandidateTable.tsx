import { memo } from "react";
import type { SettlementCandidate } from "../../../api/contracts";
import { DataTable } from "../../../components/ui";
import type { ListDensity } from "../../../components/ui/ListViewControls";
import { buildSettlementColumns, type SettlementColumnsOptions } from "./settlementCandidateColumns";

export const SettlementCandidateTable = memo(function SettlementCandidateTable({
  items,
  refreshing,
  density,
  ...columnsOptions
}: SettlementColumnsOptions & { items: SettlementCandidate[]; refreshing: boolean; density: ListDensity }) {
  const columns = buildSettlementColumns(columnsOptions);
  return (
    <div
      className="ant-table-region settlement-candidate-list"
      role="region"
      tabIndex={0}
      aria-busy={refreshing}
      aria-label="结算管理列表"
    >
      <DataTable
        refreshing={refreshing}
        size={density}
        columns={columns}
        dataSource={items}
        pagination={false}
        resizeKey="settlement-candidates"
        rowKey="id"
      />
    </div>
  );
});
