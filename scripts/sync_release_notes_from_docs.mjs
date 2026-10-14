#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { parseReleaseChangelog } from "./lib/release_notes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "wiki/更新日志.md");
const outputPath = path.join(root, "src/react/releaseNotesDocs.ts");
const source = fs.readFileSync(sourcePath, "utf8");
const notes = parseReleaseChangelog(source).map(({ note }) => note);

const generated = [
  "// Generated from wiki/更新日志.md. Run npm run release:notes:sync after editing the changelog.",
  'import type { ReleaseNote } from "./releaseNoteModel";',
  "",
  "export const DOCUMENT_RELEASE_NOTES: ReleaseNote[] = ",
  `${JSON.stringify(notes, null, 2)} as ReleaseNote[];`,
  "",
].join("\n");

fs.writeFileSync(outputPath, generated, "utf8");
const prettier = path.join(root, "node_modules", "prettier", "bin", "prettier.cjs");
const formatResult = spawnSync(process.execPath, [prettier, "--write", outputPath], { stdio: "inherit" });
if (formatResult.status !== 0) process.exit(formatResult.status ?? 1);
console.log(`Synced ${notes.length} release notes from wiki/更新日志.md.`);
