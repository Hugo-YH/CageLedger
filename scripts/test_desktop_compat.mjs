import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { platform, release } from "node:os";
import { resolve } from "node:path";

const output = resolve(process.env.CAGELEDGER_COMPAT_OUTPUT_DIR || "test-results/desktop-compat");
const firstPort = Number(process.env.CAGELEDGER_COMPAT_PORT || "5193");
if (!Number.isInteger(firstPort) || firstPort < 1024 || firstPort > 65520) {
  throw new Error("CAGELEDGER_COMPAT_PORT must be an integer from 1024 to 65520");
}
mkdirSync(output, { recursive: true });
const runs = [];
let active;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    active?.kill(signal);
    process.exitCode = 1;
  });
}
for (const [index, browser] of ["firefox", "webkit"].entries()) {
  if (process.exitCode) break;
  const port = firstPort + index * 10;
  const started = new Date().toISOString();
  const code = await new Promise((done) => {
    active = spawn(
      process.execPath,
      [
        "node_modules/@playwright/test/cli.js",
        "test",
        "--config",
        "playwright.compat.config.ts",
        ...process.argv.slice(2),
      ],
      {
        stdio: "inherit",
        env: {
          ...process.env,
          CAGELEDGER_COMPAT_BROWSER: browser,
          CAGELEDGER_COMPAT_OUTPUT_DIR: output,
          CAGELEDGER_E2E_PORT: String(port),
          CAGELEDGER_E2E_API_PORT: String(port + 1),
          CAGELEDGER_DOCS_PORT: String(port + 2),
          CAGELEDGER_E2E_REUSE: "0",
        },
      },
    );
    active.once("error", (error) => {
      console.error(error);
      done(1);
    });
    active.once("exit", (status) => done(status ?? 1));
  });
  runs.push({ browser, started, ended: new Date().toISOString(), exitCode: code });
  active = undefined;
}
writeFileSync(
  resolve(output, "run-summary.json"),
  JSON.stringify(
    { node: process.version, platform: platform(), osRelease: release(), args: process.argv.slice(2), runs },
    null,
    2,
  ) + "\n",
);
if (runs.length !== 2 || runs.some((run) => run.exitCode !== 0)) process.exitCode = 1;
