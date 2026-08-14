import { Button, Checkbox, Input, Popover, Skeleton, Space } from "antd";
import { FilterOutlined } from "@ant-design/icons";
import { useEffect, useLayoutEffect, useRef, useState } from "react";

export interface TableFilterOption {
  value: string;
  label: string;
  count: number;
}

export interface FilterableColumnTitleProps {
  label: string;
  values: string[];
  options: TableFilterOption[];
  loading?: boolean;
  filterable?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSort: () => void;
  onFilter: (values: string[]) => void;
}

export function FilterableColumnTitle({
  label,
  values,
  options,
  loading = false,
  filterable = true,
  onOpenChange,
  onSort,
  onFilter,
}: FilterableColumnTitleProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(values);
  const rootRef = useRef<HTMLSpanElement>(null);
  const [inMeasureRow, setInMeasureRow] = useState(false);

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
    setOpen(next);
  }

  const content = (
    <div className="table-filter-panel" data-ui="data-table-filter">
      <Input.Search
        allowClear
        placeholder="搜索当前列"
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />
      <Checkbox.Group
        className="table-filter-options"
        value={pending}
        onChange={(nextValues) => setPending(nextValues.map(String))}
      >
        {loading ? (
          <Skeleton active paragraph={{ rows: 3 }} title={false} />
        ) : visibleOptions.length ? (
          visibleOptions.map((option) => (
            <Checkbox key={option.value} value={option.value}>
              <span>{option.label}</span>
              <small>{option.count}</small>
            </Checkbox>
          ))
        ) : (
          <p className="muted">当前列没有可选项。</p>
        )}
      </Checkbox.Group>
      <Space className="table-filter-actions">
        <Button size="small" type="text" onClick={() => setPending([])}>
          清空
        </Button>
        <Button
          size="small"
          type="primary"
          onClick={() => {
            onFilter(pending);
            setOpen(false);
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
        <Popover content={content} open={open} placement="bottomLeft" trigger="click" onOpenChange={setPopoverOpen}>
          <Button
            className="table-filter-button"
            icon={<FilterOutlined />}
            size="small"
            type="text"
            aria-label={`筛选${label}`}
            aria-pressed={values.length > 0}
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
