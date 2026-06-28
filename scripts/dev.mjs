import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const processes = new Set();
const ephemeralDir = process.env.CAGELEDGER_EPHEMERAL_DB === "1"
  ? mkdtempSync(join(tmpdir(), "cageledger-e2e-"))
  : "";

function launch(command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: "inherit",
    env: { ...process.env, ...env },
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

launch("python3", ["server.py"], {
  CAGELEDGER_PORT: "5174",
  CAGELEDGER_DEV_ASSETS: "1",
  ...(ephemeralDir ? { CAGELEDGER_DB: join(ephemeralDir, "cageledger.sqlite") } : {}),
});
launch(process.platform === "win32" ? "npm.cmd" : "npm", ["exec", "vite", "--", "--host", "0.0.0.0", "--port", "5173"]);
