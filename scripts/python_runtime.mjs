import { constants, existsSync, accessSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

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

  if (python) return python;

  const hint = configured
    ? `CAGELEDGER_PYTHON_BIN=${configured} is unavailable.`
    : "Project virtual environment .venv is unavailable.";
  throw new Error(
    `${hint} Create it with: python3.13 -m venv .venv && .venv/bin/python -m pip install -r requirements-dev.txt`,
  );
}
