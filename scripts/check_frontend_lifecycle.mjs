#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const sourcePattern = /\.(?:tsx?|[cm]?js)$/;
const testPattern = /(?:^|\/)(?:__tests__|tests?|__mocks__)(?:\/|$)|\.(?:test|spec)\.[^.]+$/;
const statuses = new Set(["retained-legacy", "compatibility-facade", "test-support"]);

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(target) : sourcePattern.test(entry.name) ? [target] : [];
  });
}

function moduleEntries(root) {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  const entries = [];
  for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
    const attributes = Object.fromEntries(
      [...tag.matchAll(/([\w-]+)\s*=\s*["']([^"']*)["']/g)].map((match) => [match[1].toLowerCase(), match[2]]),
    );
    if (attributes.type !== "module" || !attributes.src || /^(?:https?:)?\/\//.test(attributes.src)) continue;
    entries.push(path.resolve(root, attributes.src.replace(/^\//, "")));
  }
  if (!entries.length) throw new Error("index.html has no local module entry");
  return entries;
}

function allTypeOnly(clause) {
  return clause?.elements?.length > 0 && clause.elements.every((element) => element.isTypeOnly);
}

function dependencies(filename, options) {
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
  const runtime = [],
    all = [],
    unsupported = [];
  function add(specifier, typeOnly = false) {
    if (!specifier.startsWith(".")) return;
    const target = ts.resolveModuleName(specifier, filename, options, ts.sys).resolvedModule?.resolvedFileName;
    if (target) {
      all.push(path.resolve(target));
      if (!typeOnly) runtime.push(path.resolve(target));
    } else if (sourcePattern.test(specifier) || !path.extname(specifier)) {
      unsupported.push(`unresolved local import: ${specifier}`);
    }
  }
  function visit(node) {
    if (ts.isImportDeclaration(node) && ts.isStringLiteralLike(node.moduleSpecifier)) {
      const clause = node.importClause;
      add(node.moduleSpecifier.text, clause?.isTypeOnly || (!clause?.name && allTypeOnly(clause?.namedBindings)));
    } else if (ts.isExportDeclaration(node) && node.moduleSpecifier && ts.isStringLiteralLike(node.moduleSpecifier)) {
      add(node.moduleSpecifier.text, node.isTypeOnly || allTypeOnly(node.exportClause));
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      if (ts.isStringLiteralLike(node.argument.literal)) add(node.argument.literal.text, true);
    } else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
      if (node.arguments[0] && ts.isStringLiteralLike(node.arguments[0])) add(node.arguments[0].text);
      else unsupported.push("nonliteral dynamic import requires an explicit resolver");
    } else if (
      ts.isNewExpression(node) &&
      ts.isIdentifier(node.expression) &&
      ["Worker", "SharedWorker"].includes(node.expression.text)
    ) {
      const url = node.arguments?.[0];
      const [specifier, base] = url && ts.isNewExpression(url) ? (url.arguments ?? []) : [];
      if (
        url &&
        ts.isNewExpression(url) &&
        ts.isIdentifier(url.expression) &&
        url.expression.text === "URL" &&
        specifier &&
        ts.isStringLiteralLike(specifier) &&
        base &&
        ts.isPropertyAccessExpression(base) &&
        ts.isMetaProperty(base.expression) &&
        base.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
        base.expression.name.text === "meta" &&
        base.name.text === "url"
      )
        add(specifier.text);
      else unsupported.push("nonliteral worker entry requires an explicit resolver");
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return { runtime, all, unsupported };
}

function reachable(graph, entries, kind) {
  const found = new Set(),
    pending = [...entries];
  while (pending.length) {
    const filename = pending.pop();
    if (found.has(filename)) continue;
    found.add(filename);
    pending.push(...(graph.get(filename)?.[kind] ?? []));
  }
  return found;
}

function typesOnly(filename) {
  const source = ts.createSourceFile(filename, fs.readFileSync(filename, "utf8"), ts.ScriptTarget.Latest, true);
  return source.statements.every(
    (node) =>
      ts.isInterfaceDeclaration(node) ||
      ts.isTypeAliasDeclaration(node) ||
      ts.isEmptyStatement(node) ||
      (ts.isImportDeclaration(node) &&
        (node.importClause?.isTypeOnly ||
          (!node.importClause?.name && allTypeOnly(node.importClause?.namedBindings)))) ||
      (ts.isExportDeclaration(node) && node.isTypeOnly),
  );
}

/** Static module paths are evidence of a possible runtime dependency, not menu visibility. */
export function inspectFrontendLifecycle(root, manifest) {
  root = path.resolve(root);
  const relative = (filename) => path.relative(root, filename).split(path.sep).join("/");
  const files = walk(path.join(root, "src"));
  const config = ts.readConfigFile(path.join(root, "tsconfig.json"), ts.sys.readFile);
  const options = ts.convertCompilerOptionsFromJson(config.config?.compilerOptions ?? {}, root).options;
  options.moduleResolution ??= ts.ModuleResolutionKind.Bundler;
  options.allowJs = true;
  const graph = new Map(files.map((filename) => [filename, dependencies(filename, options)]));
  const entries = moduleEntries(root);
  const runtime = reachable(graph, entries, "runtime");
  const withTypes = reachable(graph, entries, "all");
  const scope = manifest.scope ?? "src/react/features/";
  const candidates = files.filter(
    (filename) => relative(filename).startsWith(scope) && !testPattern.test(relative(filename)),
  );
  const typeOnly = candidates.filter(
    (filename) => !runtime.has(filename) && withTypes.has(filename) && typesOnly(filename),
  );
  const inactive = candidates.filter((filename) => !runtime.has(filename) && !typeOnly.includes(filename));
  const issues = [];
  if (manifest.schemaVersion !== 1 || scope !== "src/react/features/")
    issues.push("unsupported manifest schema or scope");
  const recorded = new Set();
  for (const item of manifest.modules ?? []) {
    if (recorded.has(item.path)) issues.push(`duplicate lifecycle entry: ${item.path}`);
    recorded.add(item.path);
    const filename = path.join(root, item.path);
    if (!statuses.has(item.status) || !item.reason || !item.replacement || !item.compatibilityBoundary)
      issues.push(`incomplete lifecycle entry: ${item.path}`);
    if (typeof item.replacement === "string" && !fs.existsSync(path.resolve(root, item.replacement)))
      issues.push(`missing replacement entry: ${item.path} -> ${item.replacement}`);
    if (!candidates.includes(filename)) issues.push(`missing or out-of-scope lifecycle entry: ${item.path}`);
    else if (runtime.has(filename))
      issues.push(
        `${item.status === "test-support" ? "production depends on test-support module" : "retained module is runtime reachable; review lifecycle"}: ${item.path}`,
      );
    else if (typeOnly.includes(filename)) issues.push(`active type-only module is marked retained: ${item.path}`);
  }
  for (const filename of inactive) {
    if (!recorded.has(relative(filename))) issues.push(`unclassified inactive feature module: ${relative(filename)}`);
  }
  for (const filename of runtime) {
    if (testPattern.test(relative(filename))) issues.push(`production depends on test code: ${relative(filename)}`);
    for (const detail of graph.get(filename)?.unsupported ?? []) issues.push(`${relative(filename)}: ${detail}`);
  }
  return {
    entries: entries.map(relative),
    featureModules: candidates.length,
    runtimeReachable: candidates.filter((filename) => runtime.has(filename)).length,
    activeTypeOnly: typeOnly.map(relative).sort(),
    inactiveModules: inactive.map(relative).sort(),
    issues,
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.some((arg) => !["--check", "--json"].includes(arg))) throw new Error("Use --check and/or --json");
  const root = path.resolve(fileURLToPath(new URL("..", import.meta.url)));
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "docs/contracts/frontend-lifecycle.json"), "utf8"));
  const report = inspectFrontendLifecycle(root, manifest);
  if (args.includes("--json")) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(
      `Frontend lifecycle: ${report.runtimeReachable} runtime modules, ${report.activeTypeOnly.length} active type modules, ${report.inactiveModules.length} retained modules`,
    );
    for (const issue of report.issues) console.error(issue);
  }
  if (report.issues.length) process.exitCode = 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
