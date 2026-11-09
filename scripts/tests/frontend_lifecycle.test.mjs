import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { inspectFrontendLifecycle } from "../check_frontend_lifecycle.mjs";

const fixtures = [];
const feature = (name) => `src/react/features/${name}`;
const retained = (name, status = "retained-legacy") => ({
  path: feature(name),
  status,
  reason: "retained for old fixtures",
  replacement: "src/main.tsx",
  compatibilityBoundary: "existing API remains registered",
});

function fixture(sources, modules = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cageledger-lifecycle-"));
  fixtures.push(root);
  const write = (filename, content) => {
    fs.mkdirSync(path.dirname(path.join(root, filename)), { recursive: true });
    fs.writeFileSync(path.join(root, filename), content);
  };
  write("index.html", '<script type="module" src="/src/main.tsx"></script>');
  write("tsconfig.json", JSON.stringify({ compilerOptions: { moduleResolution: "Bundler", allowJs: true } }));
  for (const [filename, content] of Object.entries(sources)) write(filename, content);
  return {
    write,
    inspect: () => inspectFrontendLifecycle(root, { schemaVersion: 1, scope: "src/react/features/", modules }),
  };
}

afterEach(() => {
  for (const root of fixtures.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

test("follows static re-exports, lazy imports and Worker URLs while distinguishing active types", () => {
  const tree = fixture({
    "src/main.tsx":
      'import "./react/features/barrel"; import type { Shape } from "./react/features/types"; void import("./react/features/lazy");',
    [feature("barrel.ts")]:
      'export { value } from "./view"; export type { Shape } from "./types"; new Worker(new URL("./scan.worker.ts", import.meta.url), { type: "module" });',
    [feature("view.ts")]: "export const value = 1;",
    [feature("lazy.ts")]: 'export * from "./nested";',
    [feature("nested.ts")]: "export const nested = 1;",
    [feature("types.ts")]: 'import { type Other } from "./otherTypes"; export interface Shape extends Other {}',
    [feature("otherTypes.ts")]: "export interface Other {}",
    [feature("scan.worker.ts")]: 'import { decode } from "./decode"; globalThis.onmessage = decode;',
    [feature("decode.ts")]: "export function decode() {}",
  });
  const report = tree.inspect();
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.activeTypeOnly, [feature("otherTypes.ts"), feature("types.ts")]);
  assert.equal(report.runtimeReachable, 6);
  assert.deepEqual(report.inactiveModules, []);
});

test("test imports and vi.mock strings cannot turn a retained screen into a production entry", () => {
  const tree = fixture(
    {
      "src/main.tsx": "export {};",
      [feature("old.tsx")]: "export function Old() { return null; }",
      [feature("old.test.tsx")]: 'import { Old } from "./old"; vi.mock("./old");',
    },
    [retained("old.tsx")],
  );
  const report = tree.inspect();
  assert.deepEqual(report.issues, []);
  assert.deepEqual(report.inactiveModules, [feature("old.tsx")]);
  assert.equal(report.runtimeReachable, 0);
});

test("fails when an inactive implementation is not classified or a retained one is reconnected", () => {
  const tree = fixture({ "src/main.tsx": "export {};", [feature("forgotten.tsx")]: "export const value = 1;" });
  assert.match(tree.inspect().issues.join("\n"), /unclassified inactive feature module/);
  const restored = fixture(
    { "src/main.tsx": 'import "./react/features/old";', [feature("old.tsx")]: "export const value = 1;" },
    [retained("old.tsx")],
  );
  assert.match(restored.inspect().issues.join("\n"), /retained module is runtime reachable/);
});

test("rejects a production dependency on declared test support or an actual test module", () => {
  const tree = fixture(
    {
      "src/main.tsx": 'import "./react/features/helper"; import "./react/features/bad.test";',
      [feature("helper.ts")]: "export const helper = 1;",
      [feature("bad.test.ts")]: "export const fixture = 1;",
    },
    [retained("helper.ts", "test-support")],
  );
  const issues = tree.inspect().issues.join("\n");
  assert.match(issues, /production depends on test-support module/);
  assert.match(issues, /production depends on test code/);
});

test("an executable module used only as a type is not silently classified as a type declaration", () => {
  const tree = fixture({
    "src/main.tsx": 'import type { Shape } from "./react/features/unusedRuntime";',
    [feature("unusedRuntime.ts")]: "export interface Shape {} export const sideEffect = 1;",
  });
  assert.deepEqual(tree.inspect().activeTypeOnly, []);
  assert.match(tree.inspect().issues.join("\n"), /unclassified inactive feature module/);
});

test("fails conservatively for unresolved or nonliteral production module paths", () => {
  const tree = fixture({
    "src/main.tsx": 'import "./missing"; const target = "./react/features/view"; void import(target);',
    [feature("view.ts")]: "export const view = 1;",
  });
  const issues = tree.inspect().issues.join("\n");
  assert.match(issues, /unresolved local import/);
  assert.match(issues, /nonliteral dynamic import/);
});

test("missing and duplicate manifest entries require a reviewed manifest update", () => {
  const tree = fixture({ "src/main.tsx": "export {};", [feature("old.ts")]: "export const old = 1;" }, [
    retained("old.ts"),
    retained("old.ts"),
    retained("removed.ts"),
  ]);
  const issues = tree.inspect().issues.join("\n");
  assert.match(issues, /duplicate lifecycle entry/);
  assert.match(issues, /missing or out-of-scope lifecycle entry/);
});
