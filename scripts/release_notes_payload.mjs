#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { releasePayloads, verifyReleaseBody } from "./lib/release_notes.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const options = {};
const allowed = new Set(["--version", "--name", "--output-dir", "--verify", "--expected"]);
try {
  for (let index = 2; index < process.argv.length; index++) {
    const option = process.argv[index];
    if (option === "--check") options.check = true;
    else if (allowed.has(option) && process.argv[index + 1] && !process.argv[index + 1].startsWith("--"))
      options[option.slice(2)] = process.argv[++index];
    else throw new Error(`Invalid release-notes argument: ${option}`);
  }
  if (options.verify) {
    if (!options.expected) throw new Error("--verify requires --expected");
    verifyReleaseBody(
      JSON.parse(fs.readFileSync(options.verify, "utf8")),
      JSON.parse(fs.readFileSync(options.expected, "utf8")),
    );
  } else {
    const source = fs.readFileSync(path.join(root, "wiki/更新日志.md"), "utf8");
    const payloads = releasePayloads(source, options.version || "", options.name);
    if (options["output-dir"]) {
      for (const [kind, payload] of Object.entries(payloads)) {
        fs.writeFileSync(path.join(options["output-dir"], `release-${kind}.json`), `${JSON.stringify(payload)}\n`);
      }
    } else if (!options.check) throw new Error("Specify --check or --output-dir");
    console.log(`Validated release notes for v${options.version}`);
  }
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
