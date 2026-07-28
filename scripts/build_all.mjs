import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const command = process.platform === "win32" ? "npx.cmd" : "npx";
const docsPublic = path.join(root, "wiki", "public");

function run(args) {
  const result = spawnSync(command, args, { cwd: root, stdio: "inherit" });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

fs.mkdirSync(docsPublic, { recursive: true });
fs.copyFileSync(path.join(root, "assets", "cageledger-icon.svg"), path.join(docsPublic, "cageledger-icon.svg"));

run(["node", "scripts/sync_release_notes_from_docs.mjs"]);
run(["vite", "build"]);
run(["vitepress", "build", "wiki", "--outDir", ".vitepress/dist"]);

const source = path.join(root, ".vitepress", "dist");
const destination = path.join(root, "web-dist", "docs");
fs.rmSync(destination, { force: true, recursive: true });
fs.cpSync(source, destination, { recursive: true });
