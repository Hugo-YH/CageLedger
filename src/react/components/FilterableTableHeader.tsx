import { ActionIcon } from "./ui/ActionIcon";
import { Alert, Button, Checkbox, Input, Popover, Skeleton, Space } from "antd";
import { FilterOutlined } from "@ant-design/icons";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ComponentRef } from "react";
import { DateFilterTree } from "./DateFilterTree";
import type { DateFilterHierarchy, TableFilterOption } from "./dateFilterModel";

export type { TableFilterOption } from "./dateFilterModel";

export interface FilterableColumnTitleProps {
  label: string;
  values: string[];
  options: TableFilterOption[];
  dateHierarchy?: DateFilterHierarchy;
  loading?: boolean;
  error?: string;
  onRetry?: () => void;
  filterable?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSort: () => void;
  onFilter: (values: string[]) => void;
}

export function FilterableColumnTitle({
  label,
  values,
  options,
  dateHierarchy,
  loading = false,
  error,
  onRetry,
  filterable = true,
  onOpenChange,
  onSort,
  onFilter,
}: FilterableColumnTitleProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(values);
  const rootRef = useRef<HTMLSpanElement>(null);
  const triggerRef = useRef<ComponentRef<typeof Button>>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const openRef = useRef(false);
  const panelId = useId();
  const [inMeasureRow, setInMeasureRow] = useState(false);
  const closeAndRestoreFocus = useCallback(() => {
    openRef.current = false;
    setOpen(false);
    triggerRef.current?.focus({ preventScroll: true });
  }, []);

  useEffect(() => {
    if (!open) return;
    const onEscape = (event: globalThis.KeyboardEvent) => {
      if (event.key !== "Escape" || !(event.target instanceof Node) || !panelRef.current?.contains(event.target))
        return;
      event.preventDefault();
      event.stopPropagation();
      closeAndRestoreFocus();
    };
    document.addEventListener("keydown", onEscape, true);
    return () => document.removeEventListener("keydown", onEscape, true);
  }, [open, closeAndRestoreFocus]);

  useLayoutEffect(() => {
    const nextInMeasureRow = Boolean(rootRef.current?.closest(".ant-table-measure-row"));
    setInMeasureRow((current) => (current === nextInMeasureRow ? current : nextInMeasureRow));
  }, []);

  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  // antd clones header titles into an aria-hidden measure row for width
  // tracking; keep that clone inert instead of duplicating focusable controls.
  if (inMeasureRow) {
    return (
      <span className="filterable-column-title" ref={rootRef}>
        {label}
      </span>
    );
  }

  const visibleOptions = options.filter((option) =>
    `${option.label} ${option.value}`.toLocaleLowerCase("zh-CN").includes(search.trim().toLocaleLowerCase("zh-CN")),
  );
  function setPopoverOpen(next: boolean) {
    if (next) {
      setPending(values);
      setSearch("");
    }
    openRef.current = next;
    setOpen(next);
  }

  const content = (
    <div
      ref={panelRef}
      id={panelId}
      className="table-filter-panel"
      data-ui="data-table-filter"
      role="group"
      aria-label={`筛选${label}选项`}
      aria-busy={loading}
    >
      <Input.Search
        aria-label={`搜索${label}筛选选项`}
        allowClear
        placeholder="搜索当前列"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <div className={dateHierarchy ? "table-date-filter-options" : "table-filter-options"}>
        {loading ? (
          <div role="status" aria-label={`${label}筛选选项正在加载`}>
            <span className="app-visually-hidden">{label}筛选选项正在加载</span>
            <Skeleton active paragraph={{ rows: 3 }} title={false} />
          </div>
        ) : error ? (
          <Alert
            type="error"
            showIcon
            title="筛选选项加载失败"
            description={error}
            action={
              onRetry ? (
                <Button icon={<ActionIcon name="refresh" />} size="small" onClick={onRetry}>
                  重试
                </Button>
              ) : undefined
            }
          />
        ) : dateHierarchy ? (
          <DateFilterTree
            label={label}
            hierarchy={dateHierarchy}
            options={options}
            search={search}
            values={pending}
            onChange={setPending}
          />
        ) : visibleOptions.length ? (
          <Checkbox.Group
            className="table-filter-checkboxes"
            value={pending}
            onChange={(nextValues) => setPending(nextValues.map(String))}
          >
            {visibleOptions.map((option) => (
              <Checkbox key={option.value} value={option.value}>
                <span>{option.label}</span>
                <small>{option.count}</small>
              </Checkbox>
            ))}
          </Checkbox.Group>
        ) : (
          <p className="muted" role="status">
            {search.trim() ? "没有匹配的筛选项，请调整搜索内容。" : "当前列没有可选项。"}
          </p>
        )}
      </div>
      <Space className="table-filter-actions">
        <Button size="small" type="text" onClick={() => setPending([])}>
          清空
        </Button>
        <Button
          size="small"
          type="primary"
          onClick={() => {
            if (!openRef.current) return;
            closeAndRestoreFocus();
            onFilter(pending);
          }}
        >
          应用
        </Button>
      </Space>
    </div>
  );

  return (
    <span
      className={`filterable-column-title ${values.length ? "is-filtered" : ""} ${open ? "is-filter-open" : ""}`}
      ref={rootRef}
    >
      <Button
        className="table-sort-button"
        size="small"
        type="text"
        onClick={onSort}
        aria-label={`${label}，点击切换排序`}
      >
        <span>{label}</span>
      </Button>
      {filterable ? (
        <Popover
          content={content}
          open={open}
          placement="bottomLeft"
          align={{ offset: [0, 0], overflow: { adjustX: true, adjustY: true, shiftX: true, shiftY: true } }}
          trigger="click"
          onOpenChange={setPopoverOpen}
        >
          <Button
            ref={triggerRef}
            className="table-filter-button"
            icon={<FilterOutlined />}
            size="small"
            type="text"
            aria-label={`筛选${label}`}
            aria-pressed={values.length > 0}
            aria-expanded={open}
            aria-controls={open ? panelId : undefined}
            onClick={(event) => event.stopPropagation()}
          />
        </Popover>
      ) : null}
    </span>
  );
}

export function FilterableTableHeader(props: FilterableColumnTitleProps) {
  return (
    <th className={`filterable-th ${props.values.length ? "is-filtered" : ""}`}>
      <FilterableColumnTitle {...props} />
    </th>
  );
}
