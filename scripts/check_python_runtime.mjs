import { resolveProjectPython } from "./python_runtime.mjs";

const python = resolveProjectPython();
console.log(`项目使用 ${python}（Python 3.13）。`);
