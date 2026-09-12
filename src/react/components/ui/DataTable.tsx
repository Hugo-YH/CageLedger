import { useMemo } from "react";
import type { KeyboardEvent, SyntheticEvent, ThHTMLAttributes } from "react";
import { Table, type TableProps } from "antd";
import { Resizable, type ResizeCallbackData } from "react-resizable";

import { MAX_COLUMN_WIDTH, MIN_COLUMN_WIDTH, pixelWidth } from "./tableColumnWidths";
import { useColumnWidths } from "./useColumnWidths";
import { ListRefreshStatus } from "./ListRefreshStatus";

const DEFAULT_COLUMN_WIDTH = 140;
const FLEX_SPACER_KEY = "__app_table_flex_spacer__";

type ResizableHeaderCellProps = ThHTMLAttributes<HTMLTableCellElement> & {
  width?: number;
  resizeLabel?: string;
  onResize?: (event: SyntheticEvent, data: ResizeCallbackData) => void;
};

function ResizableHeaderCell({ width, resizeLabel, onResize, children, ...restProps }: ResizableHeaderCellProps) {
  if (!width || !onResize) {
    return <th {...restProps}>{children}</th>;
  }
  const currentWidth = width;

  function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    event.stopPropagation();
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
          aria-label={resizeLabel || "调整列宽"}
          aria-orientation="horizontal"
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

function columnKey(column: { key?: React.Key; dataIndex?: unknown }, index: string): string {
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
type DataTableProps<RecordType> = TableProps<RecordType> & { resizeKey?: string; refreshing?: boolean };

function isRightFixedColumn<RecordType>(column: TableColumn<RecordType>): boolean {
  return column.fixed === "right" || column.fixed === "end";
}

export function DataTable<RecordType extends object>(props: DataTableProps<RecordType>) {
  return <ResizableDataTable key={props.resizeKey} {...props} />;
}

function ResizableDataTable<RecordType extends object>({
  className,
  resizeKey,
  scroll,
  components,
  size = "middle",
  refreshing,
  ...props
}: DataTableProps<RecordType>) {
  const tableClassName = ["app-data-table", className].filter(Boolean).join(" ");
  const { widths: overrides, resize } = useColumnWidths(resizeKey);
  const { mergedColumns, totalWidth, hasFluidWidth } = useMemo(() => {
    let totalWidth = 0;
    let hasFluidWidth = false;
    function resolve(column: TableColumn<RecordType>, path: string, fixed = false): TableColumn<RecordType> {
      if (column.hidden) return column;
      const isFixed = fixed || Boolean(column.fixed);
      if ("children" in column) {
        return {
          ...column,
          children: column.children.map((child, index) => resolve(child, `${path}.${index}`, isFixed)),
        };
      }
      const colKey = columnKey(column, path);
      const semanticAlign =
        column.align ??
        (colKey === "selection" ? "center" : colKey === "actions" || colKey === "action" ? "right" : undefined);
      const explicitWidth = pixelWidth(column.width);
      // Relative CSS widths stay relative and are not given pixel-based resize handles.
      if (typeof column.width === "string" && explicitWidth === undefined) {
        hasFluidWidth = true;
        return column;
      }
      const width = overrides[colKey] ?? explicitWidth ?? estimateColumnWidth(column);
      totalWidth += width;
      const existingHeaderCell = column.onHeaderCell;
      return {
        ...column,
        ...(semanticAlign ? { align: semanticAlign } : {}),
        width,
        onHeaderCell: (cellColumn) => {
          const existingProps = existingHeaderCell?.(cellColumn) ?? {};
          return {
            ...existingProps,
            style: { ...existingProps.style, textAlign: colKey === "selection" ? "center" : "left" },
            width,
            resizeLabel:
              colKey === "selection"
                ? "调整选择列宽"
                : typeof column.title === "string"
                  ? `调整${column.title}列宽`
                  : "调整列宽",
            onResize: (_event: SyntheticEvent, data?: ResizeCallbackData) => {
              if (!data) return;
              resize(colKey, data.size.width);
            },
          };
        },
      };
    }
    const resolvedColumns = props.columns?.map((column, index) => resolve(column, String(index)));
    const rightFixedIndex = resolvedColumns?.findIndex(isRightFixedColumn) ?? -1;
    const flexSpacer: TableColumn<RecordType> = {
      key: FLEX_SPACER_KEY,
      title: null,
      className: "app-table-flex-spacer",
      render: () => null,
      onHeaderCell: () => ({ "aria-hidden": true }),
      onCell: () => ({ "aria-hidden": true }),
    };
    const mergedColumns =
      resolvedColumns && rightFixedIndex >= 0
        ? [...resolvedColumns.slice(0, rightFixedIndex), flexSpacer, ...resolvedColumns.slice(rightFixedIndex)]
        : resolvedColumns;
    return { mergedColumns, totalWidth: Math.ceil(totalWidth), hasFluidWidth };
  }, [overrides, props.columns, resize]);

  const mergedComponents = useMemo(
    () => ({ ...components, header: { cell: ResizableHeaderCell, ...components?.header } }),
    [components],
  );
  const selectionWidth = props.rowSelection ? (pixelWidth(props.rowSelection.columnWidth) ?? 32) : 0;
  const expansionWidth =
    props.expandable?.expandedRowRender && props.expandable.showExpandColumn !== false
      ? (pixelWidth(props.expandable.columnWidth) ?? 48)
      : 0;
  const mergedScroll = useMemo(() => {
    const width = totalWidth + selectionWidth + expansionWidth;
    const x =
      typeof scroll?.x === "number"
        ? Math.max(scroll.x, width)
        : (scroll?.x ?? (hasFluidWidth ? "max-content" : width || undefined));
    return { ...scroll, x };
  }, [scroll, totalWidth, hasFluidWidth, selectionWidth, expansionWidth]);

  return (
    <>
      {refreshing !== undefined && <ListRefreshStatus active={refreshing} />}
      <Table<RecordType>
        {...props}
        className={tableClassName}
        columns={mergedColumns}
        components={mergedComponents}
        data-ui="data-table"
        scroll={mergedScroll}
        size={size}
      />
    </>
  );
}
