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
const required = [
  [design?.doc.includes("motionDurationFast"), "Official design baseline unavailable"],
  [provider.includes("createTheme("), "ConfigProvider must consume the shared theme"],
  [!provider.includes('componentSize="middle"'), "ConfigProvider middle is deprecated"],
  [!/(?:#[\da-f]{3,8}\b|cubic-bezier\()/i.test(tokens), "Application aliases must not duplicate the palette or easing"],
  [docsTheme.includes("src/styles/brand-tokens.css"), "Documentation must consume generated theme variables"],
];
for (const [passes, message] of required) {
  if (!passes) failures.push(message);
}
const themeCheck = spawnSync(process.execPath, ["scripts/generate_theme.mjs", "--check"], { encoding: "utf8" });
if (themeCheck.status !== 0) failures.push(themeCheck.stderr || themeCheck.stdout);

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
