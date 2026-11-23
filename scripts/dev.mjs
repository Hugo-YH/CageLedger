import { spawn } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

import { resolveProjectPython } from "./python_runtime.mjs";
import { childExitCode, createDevShutdown } from "./dev_shutdown.mjs";

const processes = new Set();
const apiPort = process.env.CAGELEDGER_DEV_API_PORT || "5174";
const appPort = process.env.CAGELEDGER_DEV_PORT || "5173";
const docsPort = process.env.CAGELEDGER_DOCS_PORT || "5175";
const devBrowserOrigins = [`http://localhost:${appPort}`, `http://127.0.0.1:${appPort}`];

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
const devHost = (process.env.CAGELEDGER_DEV_HOST ?? dotEnv.CAGELEDGER_DEV_HOST)?.trim() || "127.0.0.1";
const devOrigin = (process.env.CAGELEDGER_DEV_ORIGIN ?? dotEnv.CAGELEDGER_DEV_ORIGIN)?.trim();
const browserOrigin = devOrigin ? URL.parse(devOrigin) : null;
const devRepository = process.env.CAGELEDGER_DEV_REPOSITORY_URL ?? dotEnv.CAGELEDGER_DEV_REPOSITORY_URL;
const configuredCorsOrigins = (
  process.env.CAGELEDGER_CORS_ALLOWED_ORIGINS ||
  dotEnv.CAGELEDGER_CORS_ALLOWED_ORIGINS ||
  ""
)
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);
if (
  devOrigin &&
  (!browserOrigin ||
    !["http:", "https:"].includes(browserOrigin.protocol) ||
    browserOrigin.pathname !== "/" ||
    browserOrigin.search ||
    browserOrigin.hash ||
    browserOrigin.username ||
    browserOrigin.password)
) {
  throw new Error("CAGELEDGER_DEV_ORIGIN must be an HTTP(S) origin, such as https://dev.example.ts.net");
}
if (browserOrigin) devBrowserOrigins.push(browserOrigin.origin);
const corsAllowedOrigins = [...new Set([...configuredCorsOrigins, ...devBrowserOrigins])].join(",");
const ephemeralDir = process.env.CAGELEDGER_EPHEMERAL_DB === "1" ? mkdtempSync(join(tmpdir(), "cageledger-e2e-")) : "";

function launch(command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...dotEnv, ...env },
  });
  processes.add(child);
  child.on("exit", (code, signal) => {
    processes.delete(child);
    shutdown(childExitCode(code, signal));
  });
  return child;
}

const stopChildren = createDevShutdown(
  processes,
  () => {
    if (ephemeralDir) rmSync(ephemeralDir, { recursive: true, force: true });
  },
  (code) => process.exit(code),
);

function shutdown(code = 0) {
  void stopChildren(code).catch((error) => {
    console.error("Development shutdown failed:", error);
    process.exitCode = 1;
  });
}

process.on("SIGINT", () => shutdown(0));
process.on("SIGTERM", () => shutdown(0));

launch(resolveProjectPython(), ["server.py"], {
  CAGELEDGER_HOST: "127.0.0.1",
  CAGELEDGER_PORT: apiPort,
  CAGELEDGER_DEV_ASSETS: "1",
  // The browser uses Vite. Permit the configured browser origin when a proxy rewrites Host.
  CAGELEDGER_CORS_ALLOWED_ORIGINS: corsAllowedOrigins,
  ...(devRepository ? { CAGELEDGER_REPOSITORY_URL: devRepository } : {}),
  ...(ephemeralDir
    ? {
        CAGELEDGER_ENV: "test",
        CAGELEDGER_DB: join(ephemeralDir, "cageledger.sqlite"),
        CAGELEDGER_DATA_ROOT: ephemeralDir,
        // Isolated runs must not inherit real Gitea credentials from .env.
        CAGELEDGER_GITEA_TOKEN: process.env.CAGELEDGER_E2E_GITEA_TOKEN || "",
        // Automated tests use mocked AI and must not inherit a paid local key.
        DEEPSEEK_API_KEY: process.env.CAGELEDGER_E2E_DEEPSEEK_API_KEY || "",
        CAGELEDGER_REPOSITORY_URL: process.env.CAGELEDGER_E2E_REPOSITORY_URL || "http://127.0.0.1:1/test/feedback",
        CAGELEDGER_UPDATE_CHECK_ENABLED: "false",
        CAGELEDGER_ADMIN_USERNAME: "admin",
        CAGELEDGER_ADMIN_PASSWORD: "admin123",
      }
    : {}),
});
launch(process.platform === "win32" ? "npm.cmd" : "npm", ["exec", "vite", "--", "--host", devHost, "--port", appPort], {
  CAGELEDGER_DEV_ORIGIN: browserOrigin?.origin ?? "",
  // Test traffic must never inherit proxy targets pointing at a developer's database.
  CAGELEDGER_API_ORIGIN: ephemeralDir
    ? `http://127.0.0.1:${apiPort}`
    : process.env.CAGELEDGER_API_ORIGIN || dotEnv.CAGELEDGER_API_ORIGIN || `http://127.0.0.1:${apiPort}`,
  CAGELEDGER_DOCS_ORIGIN: ephemeralDir
    ? `http://127.0.0.1:${docsPort}`
    : process.env.CAGELEDGER_DOCS_ORIGIN || dotEnv.CAGELEDGER_DOCS_ORIGIN || `http://127.0.0.1:${docsPort}`,
});
launch(
  process.platform === "win32" ? "npm.cmd" : "npm",
  ["exec", "vitepress", "--", "dev", "wiki", "--host", "127.0.0.1", "--port", docsPort],
  { CAGELEDGER_DOCS_PORT: docsPort },
);
