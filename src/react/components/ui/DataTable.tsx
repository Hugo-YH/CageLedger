import { useEffect, useMemo, useState } from "react";
import type { KeyboardEvent, SyntheticEvent, ThHTMLAttributes } from "react";
import { Table, type TableProps } from "antd";
import { Resizable, type ResizeCallbackData } from "react-resizable";

const MIN_COLUMN_WIDTH = 64;
const MAX_COLUMN_WIDTH = 640;
const DEFAULT_COLUMN_WIDTH = 140;
const WIDTH_STORAGE_KEY = "cageledger:table-column-widths:v1";

type ResizableHeaderCellProps = ThHTMLAttributes<HTMLTableCellElement> & {
  width?: number;
  onResize?: (event: SyntheticEvent, data: ResizeCallbackData) => void;
};

function ResizableHeaderCell({ width, onResize, children, ...restProps }: ResizableHeaderCellProps) {
  if (!width || !onResize) {
    return <th {...restProps}>{children}</th>;
  }
  const currentWidth = width;

  function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    const step = event.key === "ArrowRight" ? 16 : -16;
    const nextWidth = Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, currentWidth + step));
    onResize?.(event, { node: event.currentTarget, size: { width: nextWidth, height: 0 }, handle: "e" });
  }

  return (
    <Resizable
      className="app-table-resizable"
      height={0}
      maxConstraints={[MAX_COLUMN_WIDTH, 0]}
      minConstraints={[MIN_COLUMN_WIDTH, 0]}
      onResize={onResize}
      width={width}
      draggableOpts={{ enableUserSelectHack: false }}
      handle={
        <span
          aria-label="调整列宽"
          aria-valuemax={MAX_COLUMN_WIDTH}
          aria-valuemin={MIN_COLUMN_WIDTH}
          aria-valuenow={width}
          className="react-resizable-handle"
          role="slider"
          tabIndex={0}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={handleKeyDown}
        />
      }
    >
      <th {...restProps}>{children}</th>
    </Resizable>
  );
}

function loadStoredWidths(storeKey: string | undefined): Record<string, number> {
  if (!storeKey) return {};
  try {
    const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
    if (!raw) return {};
    const all = JSON.parse(raw) as Record<string, Record<string, number>>;
    return all[storeKey] ?? {};
  } catch {
    return {};
  }
}

function columnKey(column: { key?: React.Key; dataIndex?: unknown }, index: number): string {
  if (column.key != null) return String(column.key);
  if (typeof column.dataIndex === "string") return column.dataIndex;
  if (Array.isArray(column.dataIndex)) return column.dataIndex.join(".");
  return String(index);
}

function estimateColumnWidth(column: { title?: unknown; dataIndex?: unknown }): number {
  const label =
    typeof column.title === "string" ? column.title : typeof column.dataIndex === "string" ? column.dataIndex : "";
  const textWidth = Array.from(label).reduce(
    (total, char) => total + (/[\u3000-\u9fff\uff00-\uffef]/.test(char) ? 15 : 8),
    0,
  );
  return Math.max(DEFAULT_COLUMN_WIDTH, Math.min(320, Math.ceil(textWidth) + 48));
}

/** Standard server-side business list. Keep pagination and filtering in the domain hook. */
type TableColumn<RecordType> = NonNullable<TableProps<RecordType>["columns"]>[number];

export function DataTable<RecordType extends object>({
  className,
  resizeKey,
  scroll,
  ...props
}: TableProps<RecordType> & { resizeKey?: string }) {
  const tableClassName = ["app-data-table", className].filter(Boolean).join(" ");
  const [overrides, setOverrides] = useState<Record<string, number>>(() => loadStoredWidths(resizeKey));

  useEffect(() => {
    if (!resizeKey) return;
    try {
      const raw = window.localStorage.getItem(WIDTH_STORAGE_KEY);
      const all = raw ? (JSON.parse(raw) as Record<string, Record<string, number>>) : {};
      all[resizeKey] = overrides;
      window.localStorage.setItem(WIDTH_STORAGE_KEY, JSON.stringify(all));
    } catch {
      // Width persistence is best-effort; in-session resizing still works.
    }
  }, [overrides, resizeKey]);

  const { mergedColumns, totalWidth } = useMemo(() => {
    const resolved = (props.columns ?? []).map((column, index) => {
      if ("children" in column && column.children != null) return { column, colKey: "", resizable: false, width: 0 };
      if (column.hidden) return { column, colKey: "", resizable: false, width: 0 };
      const isFixed = column.fixed != null;
      const colKey = columnKey(column, index);
      const width = isFixed
        ? typeof column.width === "number"
          ? column.width
          : estimateColumnWidth(column)
        : (overrides[colKey] ?? column.width ?? estimateColumnWidth(column));
      return { column, colKey, resizable: !isFixed, width };
    });
    const totalWidth = Math.ceil(resolved.reduce((sum, entry) => sum + entry.width, 0));
    const nextColumns = resolved.map(({ column, colKey, resizable, width }) => {
      if (!resizable) return column;
      const existingHeaderCell = "onHeaderCell" in column ? column.onHeaderCell : undefined;
      return {
        ...column,
        width,
        onHeaderCell: (cellColumn: TableColumn<RecordType>) => ({
          ...(existingHeaderCell?.(cellColumn as Parameters<NonNullable<typeof existingHeaderCell>>[0]) ?? {}),
          width,
          onResize: (_event: SyntheticEvent, data?: ResizeCallbackData) => {
            if (!data) return;
            const nextWidth = Math.round(Math.max(MIN_COLUMN_WIDTH, Math.min(MAX_COLUMN_WIDTH, data.size.width)));
            setOverrides((current) => (current[colKey] === nextWidth ? current : { ...current, [colKey]: nextWidth }));
          },
        }),
      };
    });
    return { mergedColumns: nextColumns, totalWidth };
  }, [overrides, props.columns]);

  const scrollX = typeof scroll?.x === "number" ? Math.max(scroll.x, totalWidth) : undefined;

  return (
    <Table<RecordType>
      {...props}
      className={tableClassName}
      columns={mergedColumns}
      components={{ header: { cell: ResizableHeaderCell } }}
      scroll={scroll ? { ...scroll, x: scrollX ?? scroll.x } : undefined}
      size="middle"
    />
  );
}
