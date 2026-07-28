import { execFileSync } from "node:child_process";

import { resolveProjectPython } from "./python_runtime.mjs";

const python = resolveProjectPython();
const version = execFileSync(
  python,
  ["-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"],
  {
    encoding: "utf8",
  },
).trim();

if (version !== "3.13") {
  throw new Error(`浏览器回归要求 .venv Python 3.13，当前运行时为 ${version}：${python}`);
}

console.log(`浏览器回归使用 ${python}（Python ${version}）。`);
