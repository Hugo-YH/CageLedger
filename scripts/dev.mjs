import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { resolveProjectPython } from "./python_runtime.mjs";

const processes = new Set();
const ephemeralDir = process.env.CAGELEDGER_EPHEMERAL_DB === "1" ? mkdtempSync(join(tmpdir(), "cageledger-e2e-")) : "";
const apiPort = process.env.CAGELEDGER_DEV_API_PORT || "5174";
const appPort = process.env.CAGELEDGER_DEV_PORT || "5173";
const docsPort = process.env.CAGELEDGER_DOCS_PORT || "5175";

function loadDotEnv(root) {
  const path = resolve(root, ".env");
  if (!existsSync(path)) return {};
  const loaded = {};
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key) loaded[key] = value;
  }
  return loaded;
}

const dotEnv = loadDotEnv(resolve(import.meta.dirname, ".."));

function launch(command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...dotEnv, ...env },
  });
  processes.add(child);
  child.on("exit", (code, signal) => {
    processes.delete(child);
    if (!signal && code) shutdown(code);
  });
  return child;
}

function shutdown(code = 0) {
  for (const child of processes) child.kill("SIGTERM");
  if (ephemeralDir) rmSync(ephemeralDir, { recursive: true, force: true });
  setTimeout(() => process.exit(code), 50);
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

launch(resolveProjectPython(), ["server.py"], {
  CAGELEDGER_PORT: apiPort,
  CAGELEDGER_DEV_ASSETS: "1",
  ...(ephemeralDir ? { CAGELEDGER_DB: join(ephemeralDir, "cageledger.sqlite") } : {}),
});
launch(process.platform === "win32" ? "npm.cmd" : "npm", [
  "exec",
  "vite",
  "--",
  "--host",
  "0.0.0.0",
  "--port",
  appPort,
]);
launch(process.platform === "win32" ? "npm.cmd" : "npm", [
  "exec",
  "vitepress",
  "--",
  "dev",
  "wiki",
  "--host",
  "127.0.0.1",
  "--port",
  docsPort,
]);
