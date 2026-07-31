#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const bumpIndex = process.argv.indexOf("--bump");
const bump = bumpIndex >= 0 ? process.argv[bumpIndex + 1] : "beta";

function latestTag() {
  try {
    return execFileSync("git", ["describe", "--tags", "--abbrev=0", "--match", "v*"], {
      cwd: root,
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

const tag = latestTag() || JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8")).version || "0.0.0";
const match = tag.match(/^v?(\d+)\.(\d+)\.(\d+)(?:-beta(\d+))?$/i);
if (!match) throw new Error(`无法解析版本标签: ${tag}`);

const [, majorText, minorText, patchText, betaText] = match;
const major = Number(majorText);
const minor = Number(minorText);
const patch = Number(patchText);
const beta = betaText ? Number(betaText) : 0;

let next;
switch (bump) {
  case "beta":
    next = beta ? `${major}.${minor}.${patch}-beta${beta + 1}` : `${major}.${minor}.${patch + 1}-beta1`;
    break;
  case "patch":
    next = `${major}.${minor}.${patch + 1}`;
    break;
  case "minor":
    next = `${major}.${minor + 1}.0`;
    break;
  case "major":
    next = `${major + 1}.0.0`;
    break;
  default:
    throw new Error(`未知 bump 类型: ${bump}（支持 beta|patch|minor|major）`);
}

console.log(next);
