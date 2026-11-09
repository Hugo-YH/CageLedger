import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, resolve } from "node:path";

// Usage: node scripts/documentation/publish-screenshots.mjs <capture-manifest.json> <results.json>
const [manifestArgument, resultArgument] = process.argv.slice(2);
if (!manifestArgument || !resultArgument)
  throw new Error("Provide the capture manifest and its successful Playwright results.json.");
const manifestPath = resolve(manifestArgument);
const resultPath = resolve(resultArgument);
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const results = JSON.parse(readFileSync(resultPath, "utf8"));
const root = resolve(import.meta.dirname, "../..");
const { version } = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
if (manifest.version !== version) throw new Error("Capture version differs from package.json.");
if (
  results.stats?.expected !== 1 ||
  results.stats?.unexpected !== 0 ||
  results.stats?.flaky !== 0 ||
  results.stats?.skipped !== 0
) {
  throw new Error("Screenshot promotion requires one successful capture test, without skips or retries.");
}
const suites = JSON.stringify(results.suites);
if (!suites.includes("capture current UI with isolated fictional documentation data"))
  throw new Error("The report is not the documentation capture run.");
if (!manifestPath.startsWith(resolve(dirname(resultPath), "artifacts") + "/"))
  throw new Error("Manifest and report must belong to the same evidence directory.");
const expected = [
  "dashboard.png",
  "intake.png",
  "quantity-sheets.png",
  "settlements.png",
  "workflow.png",
  "quarantine-batch.png",
];
if (manifest.screenshots.length !== expected.length) throw new Error("Incomplete capture manifest.");
const assets = manifest.screenshots.map((item) => {
  if (basename(item.file) !== item.file || !expected.includes(item.file))
    throw new Error("Unexpected screenshot filename.");
  const source = resolve(dirname(manifestPath), item.file);
  const bytes = readFileSync(source);
  if (bytes.subarray(0, 8).toString("hex") !== "89504e470d0a1a0a")
    throw new Error("Screenshot must be an original PNG.");
  if (bytes.readUInt32BE(16) !== manifest.viewport.width || bytes.readUInt32BE(20) !== manifest.viewport.height)
    throw new Error("Screenshot dimensions differ from capture metadata.");
  return { ...item, source, sha256: createHash("sha256").update(bytes).digest("hex") };
});
if (new Set(assets.map((item) => item.file)).size !== expected.length) throw new Error("Duplicate screenshots.");
const destination = resolve(root, "wiki/public/screenshots");
mkdirSync(destination, { recursive: true });
for (const asset of assets) copyFileSync(asset.source, resolve(destination, asset.file));
writeFileSync(
  resolve(destination, "manifest.json"),
  JSON.stringify(
    { ...manifest, screenshots: assets.map(({ file, view, sha256 }) => ({ file, view, sha256 })) },
    null,
    2,
  ) + "\n",
);
console.log(`Published ${assets.length} verified screenshots for ${version}.`);
