import { Table, type TableProps } from "antd";

/** Standard server-side business list. Keep pagination and filtering in the domain hook. */
export function DataTable<RecordType extends object>({ className, ...props }: TableProps<RecordType>) {
  const tableClassName = ["app-data-table", className].filter(Boolean).join(" ");
  return <Table<RecordType> {...props} className={tableClassName} size="middle" />;
}
