import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { childExitCode, createDevShutdown } from "../../scripts/dev_shutdown.mjs";

const events = [];
function child(name) {
  const value = new EventEmitter();
  value.exitCode = null;
  value.signalCode = null;
  value.kill = (signal) => events.push(`${name}:${signal}`);
  value.finish = (signal = "SIGTERM") => {
    value.signalCode = signal;
    value.emit("exit", null, signal);
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

const forced = child("forced");
const forcedStop = createDevShutdown(
  new Set([forced]),
  () => events.push("forced-cleanup"),
  (code) => events.push(`forced-exit:${code}`),
  { forceAfterMs: 1 },
);
const forcedShutdown = forcedStop(0);
forced.kill = (signal) => {
  events.push(`forced:${signal}`);
  if (signal === "SIGKILL") forced.finish("SIGKILL");
};
await forcedShutdown;
assert.ok(events.includes("forced:SIGTERM"));
assert.ok(events.includes("forced:SIGKILL"));
assert.ok(events.includes("forced-cleanup"));
assert.ok(events.includes("forced-exit:0"));

assert.equal(childExitCode(null, "SIGTERM"), 0);
assert.equal(childExitCode(null, "SIGKILL"), 1);
assert.equal(childExitCode(3, null), 3);
assert.equal(childExitCode(0, null), 0);

const empty = [];
await createDevShutdown(
  new Set(),
  () => empty.push("cleanup"),
  () => empty.push("exit"),
)();
assert.deepEqual(empty, ["cleanup", "exit"]);
console.log(
  JSON.stringify({
    passed: 5,
    scope:
      "Owned child handles, delayed acknowledgements, forced timeout, duplicate shutdown, child exit codes, already exited and empty launch",
  }),
);
