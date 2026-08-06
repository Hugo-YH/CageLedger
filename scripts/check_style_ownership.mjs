import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const manifestPath = path.join(root, "src/styles/style-ownership.json");
const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
const stylesRoot = path.join(root, "src/styles");
const cssFiles = await listCssFiles(stylesRoot);
const registered = new Set(Object.keys(manifest.stylesheets));
const violations = [];
const warnings = [];

for (const file of cssFiles) {
  const relative = path.relative(root, file);
  if (!registered.has(relative) && !relative.endsWith("index.css")) {
    violations.push(`${relative}: stylesheet is missing from style-ownership.json`);
  }
}

const indexCss = await readFile(path.join(stylesRoot, "index.css"), "utf8");
const actualOrder = [...indexCss.matchAll(/@import\s+url\(["']?([^"')]+)["']?\);/g)].map((match) =>
  normalizeImport(match[1]),
);
const expectedOrder = manifest.importOrder;
if (JSON.stringify(actualOrder) !== JSON.stringify(expectedOrder)) {
  violations.push(
    `src/styles/index.css: import order differs from the registered cascade\n` +
      `  expected: ${expectedOrder.join(" -> ")}\n` +
      `  actual:   ${actualOrder.join(" -> ")}`,
  );
}

for (const [family, definition] of Object.entries(manifest.componentFamilies)) {
  const rootSelector = definition.root;
  const owner = definition.owner;
  for (const file of cssFiles) {
    const relative = path.relative(root, file);
    const contents = await readFile(file, "utf8");
    if (!contents.includes(rootSelector)) continue;
    if (relative !== owner) {
      const message = `${relative}: ${family} (${rootSelector}) belongs to ${owner}`;
      if (definition.status === "complete") violations.push(message);
      else warnings.push(`${message} (migration in progress)`);
    }
  }
}

for (const file of cssFiles) {
  const relative = path.relative(root, file);
  const details = manifest.stylesheets[relative];
  if (!details) continue;
  const contents = await readFile(file, "utf8");
  const antSelectors = collectRuleSelectors(contents).filter((selector) => selector.includes(".ant-"));
  if (antSelectors.length && relative !== manifest.antGlobalOwner && details.status !== "compatibility") {
    const portalRoots = Object.values(manifest.componentFamilies).flatMap((family) => family.portalRoots ?? []);
    const scopeRoots = details.scopeRoots ?? [];
    const selectorPrefixes = details.selectorPrefixes ?? [];
    const unscoped = antSelectors.filter(
      (selector) =>
        !selector.includes("[data-feature=") &&
        !selector.includes("[data-ui=") &&
        !portalRoots.some((rootSelector) => selector.includes(rootSelector)) &&
        !scopeRoots.some((rootSelector) => selector.includes(rootSelector)) &&
        !selectorUsesRegisteredPrefix(selector, selectorPrefixes),
    );
    if (unscoped.length) {
      const message = `${relative}: unscoped Ant selectors require a data-feature/data-ui boundary: ${unscoped.slice(0, 3).join(", ")}`;
      if (details.status === "complete") violations.push(message);
      else warnings.push(message);
    }
  }
  const hardcodedZ = [...contents.matchAll(/z-index\s*:\s*(?!var\()[0-9]+/g)].length;
  if (hardcodedZ) {
    const message = `${relative}: ${hardcodedZ} hard-coded z-index declaration(s) remain for migration`;
    if (details.status === "complete") violations.push(message);
    else warnings.push(message);
  }
  // 硬编码色检测同时覆盖 hex 与现代 rgb()/rgba() 写法；白 alpha 覆盖层
  // （rgb(255 255 255 / N%)）是设计语言内的半透明叠加，不作为表面色违规。
  const colorValue = /(?:#[0-9a-fA-F]{3,8}\b|rgba?\(\s*(?!255 255 255\s*\/)[0-9 ,./%]+\))/;
  const colorProperty = /(?<![\w-])(?:color|background(?:-color)?|border(?:-color)?)\s*:/;
  const hardcodedColors = [
    ...contents.matchAll(new RegExp(`${colorProperty.source}\\s*${colorValue.source}`, "g")),
    ...contents.matchAll(
      new RegExp(
        `(?<![\\w-])border\\s*:\\s*[^;]*?(?:#[0-9a-fA-F]{3,8}\\b|rgba?\\(\\s*(?!255 255 255\\s*\\/)[0-9 ,./%]+\\))`,
        "g",
      ),
    ),
  ].length;
  if (hardcodedColors && details.status !== "compatibility" && relative !== "src/styles/brand-tokens.css") {
    warnings.push(`${relative}: ${hardcodedColors} hard-coded color declaration(s) remain for token migration`);
  }
}

for (const [file, definition] of Object.entries(manifest.stylesheets)) {
  if (definition.status === "compatibility") {
    warnings.push(`${file}: compatibility layer scheduled for removal after ${definition.removeAfter}`);
  }
}

for (const warning of warnings) console.warn(`STYLE OWNERSHIP WARNING: ${warning}`);
if (violations.length) {
  for (const violation of violations) console.error(`STYLE OWNERSHIP ERROR: ${violation}`);
  process.exitCode = 1;
} else {
  console.log(
    `Style ownership passed: ${cssFiles.length} stylesheets, ${Object.keys(manifest.componentFamilies).length} component families.`,
  );
}

async function listCssFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return listCssFiles(entryPath);
      return entry.name.endsWith(".css") ? [entryPath] : [];
    }),
  );
  return nested.flat();
}

function normalizeImport(value) {
  if (value.startsWith("./")) return `src/styles/${value.slice(2)}`;
  return value;
}

function collectRuleSelectors(css) {
  const selectors = [];
  const source = css.replace(/\/\*[\s\S]*?\*\//g, "");
  let buffer = "";

  for (const character of source) {
    if (character === "{") {
      const header = buffer.trim();
      buffer = "";
      if (header && !header.startsWith("@")) selectors.push(header.replace(/\s+/g, " "));
      continue;
    }
    if (character === "}") {
      buffer = "";
      continue;
    }
    buffer += character;
  }

  return selectors;
}

function selectorUsesRegisteredPrefix(selector, prefixes) {
  const parts = selector
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 0 && parts.every((part) => prefixes.some((prefix) => part.includes(prefix)));
}
