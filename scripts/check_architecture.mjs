#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import ts from "typescript";

const root = process.cwd();
const enforce = process.argv.includes("--enforce");
const sourceExtensions = new Set([".ts", ".tsx", ".py", ".css"]);
const ignoredParts = new Set([".venv", "node_modules", "web-dist", "dist", "data", "docs", "src/vendor"]);
const sizeBudgets = { ".ts": 500, ".tsx": 500, ".py": 600, ".css": 1500 };
const baselineHotspots = new Set(["server_app/legacy.py"]);

const files = walk(root).filter((file) => sourceExtensions.has(path.extname(file)));
const issues = [];

const frontendFiles = files.filter((file) => /\.(?:ts|tsx)$/.test(file) && !file.includes(".test."));
const frontendEdges = new Map(frontendFiles.map((file) => [file, []]));

for (const file of frontendFiles) {
  const source = ts.createSourceFile(file, fs.readFileSync(file, "utf8"), ts.ScriptTarget.Latest, true);
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue;
    const specifier = statement.moduleSpecifier.text;
    if (!specifier.startsWith(".")) continue;
    const target = resolveTypeScriptImport(file, specifier);
    if (target && frontendEdges.has(target)) frontendEdges.get(file).push(target);
  }
}

for (const cycle of findCycles(frontendEdges)) issues.push(`frontend cycle: ${cycle.map(relative).join(" -> ")}`);

for (const [file, dependencies] of frontendEdges) {
  const source = relative(file);
  for (const dependency of dependencies.map(relative)) {
    if (source.startsWith("src/domain/") && dependency.startsWith("src/react/")) {
      issues.push(`domain imports React: ${source} -> ${dependency}`);
    }
    if (source.startsWith("src/react/components/") && dependency.startsWith("src/react/features/")) {
      issues.push(`shared component imports feature: ${source} -> ${dependency}`);
    }
    if (source.startsWith("src/react/api/") && /src\/react\/(features|components|state|print)\//.test(dependency)) {
      issues.push(`API layer imports UI layer: ${source} -> ${dependency}`);
    }
  }
}

const pythonFiles = files.filter((file) => file.endsWith(".py") && relative(file).startsWith("server_app/"));
const pythonByModule = new Map(pythonFiles.map((file) => [pythonModule(file), file]));
const pythonEdges = new Map(pythonFiles.map((file) => [file, []]));
for (const file of pythonFiles) {
  const content = fs.readFileSync(file, "utf8");
  for (const match of content.matchAll(
    /^from\s+(server_app(?:\.[a-zA-Z0-9_]+)*)\s+import|^import\s+(server_app(?:\.[a-zA-Z0-9_]+)*)/gm,
  )) {
    const imported = match[1] || match[2];
    const target = pythonByModule.get(imported);
    if (target) pythonEdges.get(file).push(target);
  }
}
for (const cycle of findCycles(pythonEdges)) issues.push(`backend cycle: ${cycle.map(relative).join(" -> ")}`);

const hotspots = [];
for (const file of files) {
  const filePath = relative(file);
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).length;
  const budget = sizeBudgets[path.extname(file)];
  if (budget && lines > budget) {
    hotspots.push({ file: filePath, lines, budget, allowed: baselineHotspots.has(filePath) });
    if (!baselineHotspots.has(filePath)) issues.push(`size budget: ${filePath} has ${lines} lines (limit ${budget})`);
  }
}

console.log(`Architecture report: ${frontendFiles.length} frontend modules, ${pythonFiles.length} backend modules.`);
console.log(`Dependency issues: ${issues.length}. Size hotspots: ${hotspots.length}.`);
for (const item of hotspots) {
  console.log(`  ${item.allowed ? "baseline" : "new"}: ${item.file} ${item.lines}/${item.budget}`);
}
for (const issue of issues) console.error(`  issue: ${issue}`);

if (enforce && issues.length) process.exitCode = 1;

function walk(directory) {
  const output = [];
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    const rel = relative(fullPath);
    if ([...ignoredParts].some((part) => rel === part || rel.startsWith(`${part}/`))) continue;
    if (entry.isDirectory()) output.push(...walk(fullPath));
    else output.push(fullPath);
  }
  return output;
}

function relative(file) {
  return path.relative(root, file).replaceAll(path.sep, "/");
}

function resolveTypeScriptImport(file, specifier) {
  const base = path.resolve(path.dirname(file), specifier);
  return [`${base}.ts`, `${base}.tsx`, path.join(base, "index.ts"), path.join(base, "index.tsx")].find(fs.existsSync);
}

function pythonModule(file) {
  return relative(file)
    .replace(/\.py$/, "")
    .replaceAll("/", ".")
    .replace(/\.__init__$/, "");
}

function findCycles(edges) {
  const cycles = [];
  const active = new Set();
  const complete = new Set();
  function visit(node, stack) {
    if (active.has(node)) {
      const start = stack.indexOf(node);
      cycles.push([...stack.slice(start), node]);
      return;
    }
    if (complete.has(node)) return;
    active.add(node);
    stack.push(node);
    for (const dependency of edges.get(node) || []) visit(dependency, stack);
    stack.pop();
    active.delete(node);
    complete.add(node);
  }
  for (const node of edges.keys()) visit(node, []);
  return cycles;
}
