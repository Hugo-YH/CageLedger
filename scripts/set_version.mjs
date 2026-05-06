#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packagePath = path.join(root, "package.json");
const packageJson = JSON.parse(fs.readFileSync(packagePath, "utf8"));
const oldVersion = packageJson.version;

function nextPatch(version) {
  const parts = version.split(".").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part))) {
    throw new Error(`Unsupported semver version: ${version}`);
  }
  parts[2] += 1;
  return parts.join(".");
}

function argValue(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : "";
}

const explicitVersion = argValue("--version");
const bump = argValue("--bump");
const newVersion = explicitVersion || (bump === "patch" ? nextPatch(oldVersion) : "");

if (!newVersion || !/^\d+\.\d+\.\d+[0-9A-Za-z.-]*$/.test(newVersion)) {
  throw new Error("Usage: node scripts/set_version.mjs --version 0.3.1 OR --version 0.4.0a OR --bump patch");
}

function writeText(file, text) {
  fs.writeFileSync(path.join(root, file), text, "utf8");
}

function readText(file) {
  return fs.readFileSync(path.join(root, file), "utf8");
}

packageJson.version = newVersion;
fs.writeFileSync(packagePath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

let indexHtml = readText("index.html");
indexHtml = indexHtml.replaceAll(`?v=${oldVersion}`, `?v=${newVersion}`);
writeText("index.html", indexHtml);

let appJs = readText("src/app.js");
appJs = appJs.replace(
  /(let systemInfo = \{[\s\S]*?\n\s*version: )"[^"]+"/,
  `$1"${newVersion}"`,
);
writeText("src/app.js", appJs);

let deployment = readText("docs/DEPLOYMENT.md");
deployment = deployment.replaceAll(oldVersion, newVersion);
writeText("docs/DEPLOYMENT.md", deployment);

console.log(newVersion);
