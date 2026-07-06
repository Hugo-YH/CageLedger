import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

export interface TableFilterOption {
  value: string;
  label: string;
  count: number;
}

export function FilterableTableHeader({
  label,
  values,
  options,
  loading = false,
  onOpenChange,
  onSort,
  onFilter,
}: {
  label: string;
  values: string[];
  options: TableFilterOption[];
  loading?: boolean;
  onOpenChange?: (open: boolean) => void;
  onSort: () => void;
  onFilter: (values: string[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [pending, setPending] = useState(values);
  const rootRef = useRef<HTMLTableCellElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelStyle, setPanelStyle] = useState<{ top: number; left: number; width: number }>({
    top: 0,
    left: 0,
    width: 280,
  });

  useEffect(() => {
    if (!open) return;
    const close = (event: PointerEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target) || panelRef.current?.contains(target)) return;
      setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [open]);

  useLayoutEffect(() => {
    if (!open) return;
    const update = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;
      const viewportPadding = 12;
      const width = Math.min(280, window.innerWidth - viewportPadding * 2);
      const heightEstimate = 360;
      const left = Math.min(Math.max(rect.left, viewportPadding), window.innerWidth - width - viewportPadding);
      const openAbove =
        rect.bottom + 8 + heightEstimate > window.innerHeight && rect.top - heightEstimate > viewportPadding;
      const top = openAbove ? Math.max(rect.top - heightEstimate - 8, viewportPadding) : rect.bottom + 8;
      setPanelStyle({ top, left, width });
    };
    update();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open]);

  useEffect(() => {
    onOpenChange?.(open);
  }, [onOpenChange, open]);

  const visibleOptions = options.filter((option) =>
    `${option.label} ${option.value}`.toLocaleLowerCase("zh-CN").includes(search.trim().toLocaleLowerCase("zh-CN")),
  );
  const toggle = () => {
    setOpen((current) => {
      const next = !current;
      if (next) {
        setPending(values);
        setSearch("");
      }
      return next;
    });
  };

  return (
    <th ref={rootRef} className={`filterable-th ${values.length ? "is-filtered" : ""} ${open ? "is-filter-open" : ""}`}>
      <button className="table-sort-button" type="button" onClick={onSort} aria-label={`${label}，点击切换排序`}>
        <span>{label}</span>
      </button>
      <button
        ref={triggerRef}
        className="table-filter-button"
        type="button"
        onClick={toggle}
        aria-label={`筛选${label}`}
        aria-expanded={open}
      >
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M4 5h16l-6 7v5l-4 2v-7z" />
        </svg>
      </button>
      {open
        ? createPortal(
            <div
              ref={panelRef}
              className="table-filter-panel"
              style={{ top: `${panelStyle.top}px`, left: `${panelStyle.left}px`, width: `${panelStyle.width}px` }}
            >
              <div className="table-filter-search">
                <input
                  type="search"
                  value={search}
                  placeholder="搜索当前列"
                  onChange={(event) => setSearch(event.target.value)}
                />
              </div>
              <div className="table-filter-options">
                {loading ? (
                  <p className="muted">正在加载筛选项...</p>
                ) : visibleOptions.length ? (
                  visibleOptions.map((option) => (
                    <label key={option.value}>
                      <input
                        type="checkbox"
                        checked={pending.includes(option.value)}
                        onChange={(event) =>
                          setPending((current) =>
                            event.target.checked
                              ? [...new Set([...current, option.value])]
                              : current.filter((value) => value !== option.value),
                          )
                        }
                      />
                      <span>{option.label}</span>
                      <small>{option.count}</small>
                    </label>
                  ))
                ) : (
                  <p className="muted">当前列没有可选项。</p>
                )}
              </div>
              <div className="table-filter-actions">
                <button className="ghost compact" type="button" onClick={() => setPending([])}>
                  清空
                </button>
                <button
                  className="primary compact"
                  type="button"
                  onClick={() => {
                    onFilter(pending);
                    setOpen(false);
                  }}
                >
                  应用
                </button>
              </div>
            </div>,
            document.body,
          )
        : null}
    </th>
  );
}
