import { constants, existsSync, accessSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const verifiedPythons = new Set();

function isExecutable(path) {
  try {
    accessSync(path, constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

export function resolveProjectPython() {
  const configured = process.env.CAGELEDGER_PYTHON_BIN?.trim();
  const candidates = configured
    ? [configured]
    : [join(projectRoot, ".venv", "bin", "python"), join(projectRoot, ".venv", "Scripts", "python.exe")];
  const python = candidates.find((candidate) => existsSync(candidate) && isExecutable(candidate));

  if (python) {
    if (!verifiedPythons.has(python)) {
      const version = execFileSync(
        python,
        ["-I", "-c", "import sys; print(f'{sys.version_info.major}.{sys.version_info.minor}')"],
        {
          encoding: "utf8",
          timeout: 10_000,
        },
      ).trim();
      if (version !== "3.13") throw new Error(`项目要求 Python 3.13，当前运行时为 ${version}：${python}`);
      verifiedPythons.add(python);
    }
    return python;
  }

  const hint = configured
    ? `CAGELEDGER_PYTHON_BIN=${configured} is unavailable.`
    : "Project virtual environment .venv is unavailable.";
  throw new Error(
    `${hint} Create it with: python3.13 -m venv .venv && .venv/bin/python -m pip install -r requirements-dev.txt`,
  );
}
