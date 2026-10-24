import { spawn } from "node:child_process";

import { resolveProjectPython } from "./python_runtime.mjs";

const args = process.argv.slice(2);
if (args.length === 0) throw new Error("Usage: node scripts/run_python.mjs <python arguments>");

const child = spawn(resolveProjectPython(), args, {
  env: process.env,
  stdio: "inherit",
});

let stopping = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    if (stopping || child.exitCode !== null || child.signalCode !== null) return;
    stopping = true;
    // Forward only to the child we started; keep the launcher alive until it exits.
    child.kill(signal);
  });
}

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
