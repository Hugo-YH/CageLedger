export interface TableFilterOption {
  value: string;
  label: string;
  count: number;
}

export type DateFilterHierarchy = "month" | "day" | "datetime";

export interface DateFilterNode {
  key: string;
  title: string;
  fullLabel: string;
  count: number;
  values: string[];
  children?: DateFilterNode[];
}

function calendarParts(value: string, hierarchy: DateFilterHierarchy): number[] | null {
  const match = value.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?(.*)$/);
  if (!match) return null;
  const [, yearText, monthText, dayText, rest] = match;
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (month < 1 || month > 12) return null;
  if (hierarchy === "month") return dayText || rest ? null : [year, month];
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (!dayText || day < 1 || day > days[month - 1]) return null;
  if (hierarchy === "day") return rest ? null : [year, month, day];
  if (!rest) return [year, month, day];
  if (!/^[T ]\d{2}:\d{2}/.test(rest)) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : [date.getFullYear(), date.getMonth() + 1, date.getDate()];
}

/** Group display dates, retaining every original API value (including timestamps). */
export function buildDateFilterTree(
  options: TableFilterOption[],
  hierarchy: DateFilterHierarchy,
  search = "",
): DateFilterNode[] {
  const nodes = new Map<string, DateFilterNode>();
  const roots: DateFilterNode[] = [];
  const other: DateFilterNode[] = [];
  const query = search.trim().toLocaleLowerCase("zh-CN");
  for (const option of options) {
    const parts = calendarParts(option.value, hierarchy);
    const fullLabel = parts?.map((part, index) => `${part}${["年", "月", "日"][index]}`).join("") || option.label;
    const dateText = parts?.map((part, index) => (index ? String(part).padStart(2, "0") : String(part))).join("-");
    if (!`${option.value} ${option.label} ${fullLabel} ${dateText || ""}`.toLocaleLowerCase("zh-CN").includes(query))
      continue;
    if (!parts) {
      other.push({
        key: `value:${option.value}`,
        title: option.label || option.value || "空白",
        fullLabel,
        count: option.count,
        values: [option.value],
      });
      continue;
    }
    let siblings = roots;
    for (let depth = 0; depth < parts.length; depth += 1) {
      const prefix = parts.slice(0, depth + 1);
      const key = `date:${prefix.map((part) => String(part).padStart(2, "0")).join("-")}`;
      let node = nodes.get(key);
      if (!node) {
        node = {
          key,
          title: `${parts[depth]}${["年", "月", "日"][depth]}`,
          fullLabel: prefix.map((part, index) => `${part}${["年", "月", "日"][index]}`).join(""),
          count: 0,
          values: [],
          ...(depth < parts.length - 1 ? { children: [] } : {}),
        };
        siblings.push(node);
        nodes.set(key, node);
      }
      node.values.push(option.value);
      node.count += option.count;
      siblings = node.children || [];
    }
  }
  function sort(nodes: DateFilterNode[]) {
    nodes.sort((left, right) => right.key.localeCompare(left.key));
    nodes.forEach((node) => node.children && sort(node.children));
  }
  sort(roots);
  return [...other, ...roots];
}

export function dateFilterTreeState(nodes: DateFilterNode[], values: string[]) {
  const selected = new Set(values);
  const checked: string[] = [];
  const halfChecked: string[] = [];
  const branches: string[] = [];
  function visit(node: DateFilterNode) {
    const count = node.values.filter((value) => selected.has(value)).length;
    if (count === node.values.length) checked.push(node.key);
    else if (count) halfChecked.push(node.key);
    if (node.children) {
      branches.push(node.key);
      node.children.forEach(visit);
    }
  }
  nodes.forEach(visit);
  return { checked, halfChecked, branches };
}

export function toggleDateFilterValues(current: string[], target: string[], checked: boolean) {
  const next = new Set(current);
  target.forEach((value) => (checked ? next.add(value) : next.delete(value)));
  return [...next];
}
