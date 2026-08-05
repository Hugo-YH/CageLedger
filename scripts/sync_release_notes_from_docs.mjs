#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = path.join(root, "wiki/更新日志.md");
const outputPath = path.join(root, "src/react/releaseNotesDocs.ts");
const source = fs.readFileSync(sourcePath, "utf8").replace(/\r\n/g, "\n");
const blocks = source.split(/^## /m).slice(1);

const notes = blocks.map((block) => {
  const [heading, ...bodyLines] = block.split("\n");
  const headingMatch = heading.match(/^v?([^·\s（]+)(?:（([^）]+)）)?(?:\s+·\s+(.+))?\s*$/);
  if (!headingMatch) throw new Error(`Invalid release heading: ## ${heading}`);
  const body = bodyLines.join("\n");
  const titleMatch = body.match(/^###\s+(.+)$/m);
  if (!titleMatch) throw new Error(`Release v${headingMatch[1]} requires a level-three title.`);
  const items = [...body.matchAll(/^-\s+(.+)$/gm)].map((match) => match[1].trim());
  if (items.length === 0) throw new Error(`Release v${headingMatch[1]} requires at least one item.`);
  const noteMatch = body.match(/^>\s*备注：(.+)$/m);
  return {
    version: headingMatch[1],
    ...(headingMatch[2] ? { build: headingMatch[2].trim().replace(/^Build\s*/i, "") } : {}),
    ...(headingMatch[3] ? { releasedAt: headingMatch[3].trim() } : {}),
    title: titleMatch[1].trim(),
    items,
    ...(noteMatch ? { note: noteMatch[1].trim() } : {}),
  };
});

const seen = new Set();
for (const note of notes) {
  if (seen.has(note.version)) throw new Error(`Duplicate release version in wiki/更新日志.md: ${note.version}`);
  seen.add(note.version);
}

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
