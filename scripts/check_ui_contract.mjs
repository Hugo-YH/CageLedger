import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const required = [
  "src/react/components/ui/AntdProvider.tsx",
  "src/react/components/ui/ActionButton.tsx",
  "src/react/components/ui/CommandBar.tsx",
  "src/react/components/ui/DataTable.tsx",
  "src/react/components/ui/Dialog.tsx",
  "src/react/components/ui/Feedback.tsx",
  "src/react/components/ui/FormField.tsx",
  "src/react/components/ui/HelpPopover.tsx",
  "src/react/components/ui/Sheet.tsx",
  "src/react/components/ui/StatusTag.tsx",
  "docs/contracts/ui-component-standard.md",
];
const failures = required.filter((path) => !existsSync(join(root, path))).map((path) => `缺少 UI 标准文件：${path}`);

const source = walk(join(root, "src"));
for (const path of source) {
  const text = readFileSync(path, "utf8");
  if (/transition:\s*all\b/.test(text)) failures.push(`${relative(path)} 使用 transition: all`);
  if (/z-index:\s*(?:[1-9]\d{3,}|\d{5,})/.test(text)) failures.push(`${relative(path)} 使用未登记的高层级 z-index`);
}

if (failures.length) {
  console.error("UI 契约检查失败：\n" + failures.map((failure) => `- ${failure}`).join("\n"));
  process.exit(1);
}

console.log("UI 契约检查通过：Ant 适配层、文档和动画基础规则已就绪。");

function walk(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walk(path);
    return /\.(?:css|tsx?|md)$/.test(entry.name) ? [path] : [];
  });
}

function relative(path) {
  return path.slice(root.length + 1);
}
