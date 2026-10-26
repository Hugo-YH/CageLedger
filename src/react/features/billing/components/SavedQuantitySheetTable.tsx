import { type TableProps } from "antd";
import { memo } from "react";
import type { QuantitySheetListItem } from "../../../api/contracts";
import { DataTable } from "../../../components/ui";

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
      pagination={false}
      resizeKey="quantity-saved"
      rowKey="id"
    />
  );
});
