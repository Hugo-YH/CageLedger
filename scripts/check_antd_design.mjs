import { spawnSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const cli = join(root, "node_modules", "@ant-design", "cli", "dist", "index.js");
const failures = [];

if (!existsSync(cli)) {
  failures.push("缺少本地 @ant-design/cli；请执行 npm ci。");
}

const design = failures.length ? null : runJson(["design.md", "--format", "json"]);
const doctor = failures.length ? null : runJson(["doctor", "--format", "json"]);
const usage = failures.length ? null : runJson(["usage", "./src", "--format", "json"]);
const lint = failures.length ? null : runJson(["lint", "./src", "--format", "json"]);

if (doctor && (doctor.summary.warn > 0 || doctor.summary.fail > 0)) {
  failures.push(`Ant Design doctor: ${doctor.summary.warn} warning(s), ${doctor.summary.fail} failure(s)。`);
}
if (lint && lint.summary.total > 0) {
  failures.push(
    `Ant Design lint: ${lint.summary.total} issue(s) (deprecated ${lint.summary.deprecated}, a11y ${lint.summary.a11y}, usage ${lint.summary.usage}, performance ${lint.summary.performance})。`,
  );
}

const provider = read("src/react/components/ui/AntdProvider.tsx");
const tokens = read("src/styles/tokens.css");
const docsTheme = read("wiki/.vitepress/theme/styles.css");
const componentContract = read("docs/contracts/ui-component-standard.md");
const colorContract = read("docs/contracts/ui-color-system.md");
const wikiContract = read("wiki/UI组件标准.md");
const required = [
  [design?.doc.includes("primary: '#1677FF'"), "Ant Design design.md 未提供官方蓝 #1677FF 基线。"],
  [provider.includes('colorPrimary: "#1677ff"'), "ConfigProvider 主色未使用 #1677ff。"],
  [provider.includes('colorLink: "#0958d9"'), "ConfigProvider 链接未使用高对比官方蓝阶 #0958d9。"],
  [provider.includes('colorPrimary: "var(--primary-control)"'), "ConfigProvider 主按钮未使用高对比官方蓝阶。"],
  [tokens.includes("--primary: #1677ff;"), "应用 CSS 主色未使用 #1677ff。"],
  [tokens.includes("--primary-dark: #0958d9;"), "应用 CSS 未声明官方蓝 active 阶 #0958d9。"],
  [docsTheme.includes("--vp-c-brand-1: var(--cl-brand-1);"), "文档站未复用品牌 Token。"],
  [componentContract.includes("按压 100ms、浮层 200ms、Drawer/Modal 300ms"), "组件契约未使用官方动效时长。"],
  [colorContract.includes("默认高度为 `32px`，紧凑操作为 `24px`，强调操作为 `40px`"), "颜色契约未使用标准控件高度。"],
  [
    wikiContract.includes("按压反馈使用 100ms，Tooltip/Popover 使用 200ms，抽屉和 Modal 使用 300ms"),
    "Wiki 组件标准未同步官方动效。",
  ],
];
for (const [passes, message] of required) {
  if (!passes) failures.push(message);
}

const report = {
  tool: "@ant-design/cli",
  designBaseline: "#1677ff",
  doctor: doctor?.summary ?? null,
  usage: usage?.summary ?? null,
  lint: lint?.summary ?? null,
  contractFailures: failures,
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) process.exitCode = 1;

function runJson(args) {
  const result = spawnSync(process.execPath, [cli, ...args], { cwd: root, encoding: "utf8" });
  if (result.status !== 0) {
    failures.push(`antd ${args[0]} 执行失败：${result.stderr.trim() || result.stdout.trim()}`);
    return null;
  }
  try {
    return JSON.parse(result.stdout);
  } catch {
    failures.push(`antd ${args[0]} 未输出有效 JSON。`);
    return null;
  }
}

function read(relativePath) {
  return readFileSync(join(root, relativePath), "utf8");
}
