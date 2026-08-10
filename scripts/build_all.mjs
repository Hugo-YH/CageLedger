import { spawnSync } from "node:child_process";
import { gzipSync } from "node:zlib";
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

function precompressStaticAssets(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      precompressStaticAssets(target);
      continue;
    }
    if (!entry.isFile() || entry.name.endsWith(".gz") || fs.statSync(target).size < 1024) continue;
    fs.writeFileSync(`${target}.gz`, gzipSync(fs.readFileSync(target), { level: 9 }));
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
precompressStaticAssets(path.join(root, "web-dist"));
