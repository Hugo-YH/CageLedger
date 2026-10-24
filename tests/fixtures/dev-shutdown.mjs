import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { createDevShutdown } from "../../scripts/dev_shutdown.mjs";

const events = [];
function child(name) {
  const value = new EventEmitter();
  value.exitCode = null;
  value.signalCode = null;
  value.kill = (signal) => events.push(`${name}:${signal}`);
  value.finish = () => {
    value.signalCode = "SIGTERM";
    value.emit("exit", null, "SIGTERM");
  };
  return value;
}
const api = child("api");
const assets = child("assets");
const children = new Set([api, assets]);
const stop = createDevShutdown(
  children,
  () => events.push("delete-generated-data"),
  (code) => events.push(`exit:${code}`),
);
const first = stop(0);
const repeated = stop(1);
assert.equal(first, repeated);
assert.deepEqual(events, ["api:SIGTERM", "assets:SIGTERM"]);
api.finish();
await Promise.resolve();
assert.ok(!events.includes("delete-generated-data"));
assets.finish();
await first;
assert.deepEqual(events, ["api:SIGTERM", "assets:SIGTERM", "delete-generated-data", "exit:0"]);

const done = child("done");
done.exitCode = 0;
const immediate = [];
await createDevShutdown(
  new Set([done]),
  () => immediate.push("cleanup"),
  (code) => immediate.push(code),
)(3);
assert.deepEqual(immediate, ["cleanup", 3]);
assert.ok(!events.includes("done:SIGTERM"));

const empty = [];
await createDevShutdown(
  new Set(),
  () => empty.push("cleanup"),
  () => empty.push("exit"),
)();
assert.deepEqual(empty, ["cleanup", "exit"]);
console.log(
  JSON.stringify({
    passed: 3,
    scope: "Owned child handles, delayed acknowledgements, duplicate shutdown, already exited and empty launch",
  }),
);
