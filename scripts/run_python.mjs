import { spawn } from "node:child_process";

import { resolveProjectPython } from "./python_runtime.mjs";

const args = process.argv.slice(2);
if (args.length === 0) throw new Error("Usage: node scripts/run_python.mjs <python arguments>");

const child = spawn(resolveProjectPython(), args, {
  env: process.env,
  stdio: "inherit",
});

child.on("error", (error) => {
  console.error(error.message);
  process.exitCode = 1;
});
child.on("exit", (code, signal) => {
  process.exitCode = code ?? (signal ? 1 : 0);
});
