import { type TableProps } from "antd";
import { memo } from "react";
import type { QuantitySheetListItem } from "../../../api/contracts";
import { DataTable } from "../../../components/ui";
import { EmptyState } from "../../../components/ui/EmptyState";

export const SavedQuantitySheetTable = memo(function SavedQuantitySheetTable({
  columns,
  items,
  refreshing,
}: {
  columns: TableProps<QuantitySheetListItem>["columns"];
  items: QuantitySheetListItem[];
  refreshing: boolean;
}) {
  return (
    <DataTable
      refreshing={refreshing}
      className="quantity-saved-table"
      columns={columns}
      dataSource={items}
      locale={{
        emptyText: (
          <EmptyState title="暂无匹配的数量统计表" detail="可调整列筛选，或在「录入数量统计表」中录入并保存统计表。" />
        ),
      }}
      pagination={false}
      resizeKey="quantity-saved"
      rowKey="id"
    />
  );
});
