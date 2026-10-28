import { Tree } from "antd";
import { CaretDownOutlined } from "@ant-design/icons";
import { useMemo, useState, type Key } from "react";

import {
  buildDateFilterTree,
  dateFilterTreeState,
  toggleDateFilterValues,
  type DateFilterHierarchy,
  type DateFilterNode,
  type TableFilterOption,
} from "./dateFilterModel";
import { useMediaQuery } from "../hooks/useMediaQuery";

export function DateFilterTree({
  label,
  hierarchy,
  options,
  search,
  values,
  onChange,
}: {
  label: string;
  hierarchy: DateFilterHierarchy;
  options: TableFilterOption[];
  search: string;
  values: string[];
  onChange: (values: string[]) => void;
}) {
  const nodes = useMemo(() => buildDateFilterTree(options, hierarchy, search), [options, hierarchy, search]);
  const state = useMemo(() => dateFilterTreeState(nodes, values), [nodes, values]);
  const [expanded, setExpanded] = useState<Key[]>([]);
  const [searchExpansion, setSearchExpansion] = useState<{ query: string; keys: Key[] }>();
  const compact = useMediaQuery("(max-height: 500px)");
  if (!nodes.length) {
    return (
      <p className="muted" role="status">
        {search.trim() ? "没有匹配的筛选项，请调整搜索内容。" : "当前列没有可选项。"}
      </p>
    );
  }
  return (
    <Tree<DateFilterNode>
      className="table-date-filter-tree"
      classNames={{ item: "table-date-filter-item", itemSwitcher: "table-date-filter-switcher" }}
      switcherIcon={<CaretDownOutlined aria-hidden />}
      aria-label={`${label}日期筛选`}
      checkable
      checkStrictly
      selectable={false}
      blockNode
      height={compact ? 132 : 220}
      treeData={nodes}
      checkedKeys={{ checked: state.checked, halfChecked: state.halfChecked }}
      expandedKeys={
        search.trim() ? (searchExpansion?.query === search ? searchExpansion.keys : state.branches) : expanded
      }
      onExpand={(keys) => (search.trim() ? setSearchExpansion({ query: search, keys }) : setExpanded(keys))}
      onCheck={(_, info) => onChange(toggleDateFilterValues(values, info.node.values, info.checked))}
      titleRender={(node) => (
        <span className="table-date-filter-title" title={node.fullLabel}>
          <span>{node.title}</span>
          <small>{node.count}</small>
        </span>
      )}
    />
  );
}
