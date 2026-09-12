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
  if (
    path.endsWith(".tsx") &&
    relative(path) !== "src/react/components/ui/CommandBar.tsx" &&
    /data-ui=["']workspace-toolbar["']/.test(text)
  ) {
    failures.push(`${relative(path)} 直接声明公共工具栏，请使用 CommandBar 或 WorkspaceToolbar`);
  }
  if (/transition:\s*all\b/.test(text)) failures.push(`${relative(path)} 使用 transition: all`);
  if (/z-index:\s*(?:[1-9]\d{3,}|\d{5,})/.test(text)) failures.push(`${relative(path)} 使用未登记的高层级 z-index`);
}

const motionContracts = [
  ["src/styles/tokens.css", "--motion-fast: 140ms;", "应用微交互时长"],
  ["src/styles/tokens.css", "--motion-base: 220ms;", "应用常规动效时长"],
  ["src/styles/tokens.css", "--motion-slow: 280ms;", "应用浮层动效时长"],
  ["src/styles/tokens.css", "--ease-out: cubic-bezier(0.2, 0, 0, 1);", "应用标准缓动"],
  ["src/styles/brand-tokens.css", "--cl-motion-fast: 140ms;", "跨表面微交互时长"],
  ["src/styles/brand-tokens.css", "--cl-motion-base: 220ms;", "跨表面常规动效时长"],
  ["src/styles/brand-tokens.css", "--cl-motion-overlay: 280ms;", "跨表面浮层动效时长"],
  ["src/react/components/ui/AntdProvider.tsx", 'motionDurationFast: "0.14s"', "Ant 微交互时长"],
  ["src/react/components/ui/AntdProvider.tsx", 'motionDurationMid: "0.22s"', "Ant 常规动效时长"],
  ["src/react/components/ui/AntdProvider.tsx", 'motionDurationSlow: "0.28s"', "Ant 浮层动效时长"],
];
for (const [path, contract, label] of motionContracts) {
  const text = readFileSync(join(root, path), "utf8");
  if (!text.includes(contract)) failures.push(`${path} 缺少${label}契约：${contract}`);
}

const projectHomeStyles = readFileSync(join(root, "src/styles/features/project-home.css"), "utf8");
if (/animation:[^;]*\binfinite\b/.test(projectHomeStyles)) {
  failures.push("src/styles/features/project-home.css 使用持续循环的装饰动画");
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
