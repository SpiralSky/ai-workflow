import assert from "node:assert/strict";
import { test } from "node:test";
import { Sidecar } from "../src/index.ts";
import { makeWorkspace, skipReason, venvEnv } from "./pyfixture.ts";

const fresh = () => new Sidecar({ root: makeWorkspace({}), env: venvEnv() });

test("lazy start, concurrent calls matched by id", { skip: skipReason }, async () => {
  const sc = fresh();
  try {
    assert.equal(sc.pid, undefined);
    const [a, b, c] = (await Promise.all([sc.call("ping", { sleep: 0.2 }), sc.call("ping", {}), sc.call("ping", {})])) as { pid: number }[];
    assert.equal(a!.pid, sc.pid);
    assert.equal(b!.pid, c!.pid);
    await assert.rejects(sc.call("nope", {}), /unknown method: nope/);
  } finally { sc.close(); }
});

test("crash rejects in-flight calls and the next call restarts", { skip: skipReason }, async () => {
  const sc = fresh();
  try {
    await sc.call("ping", {});
    const first = sc.pid!;
    const inflight = sc.call("ping", { sleep: 5 });
    process.kill(first, "SIGKILL");
    await assert.rejects(inflight, /sidecar crashed/);
    const r = (await sc.call("ping", {})) as { pid: number };
    assert.notEqual(r.pid, first);
    assert.equal(sc.pid, r.pid);
  } finally { sc.close(); }
});

test("abort rejects only that call", { skip: skipReason }, async () => {
  const sc = fresh();
  try {
    await sc.call("ping", {});
    const ac = new AbortController();
    const slow = sc.call("ping", { sleep: 0.5 }, ac.signal);
    const other = sc.call("ping", {});
    ac.abort();
    await assert.rejects(slow, /^Error: aborted$/);
    assert.ok(((await other) as { pong: boolean }).pong);
    const pre = AbortSignal.abort();
    await assert.rejects(sc.call("ping", {}, pre), /aborted/);
    assert.ok(((await sc.call("ping", {})) as { pong: boolean }).pong);
  } finally { sc.close(); }
});

test("close() rejects in-flight calls; later call restarts", { skip: skipReason }, async () => {
  const sc = fresh();
  const p = sc.call("ping", { sleep: 5 });
  sc.close();
  await assert.rejects(p, /sidecar crashed/);
  assert.ok(((await sc.call("ping", {})) as { pong: boolean }).pong);
  sc.close();
});

test("missing venv fails with a clear error", async () => {
  const sc = new Sidecar({ root: makeWorkspace({}), env: { ...process.env, AIW_VENV: "/nonexistent/venv" } });
  await assert.rejects(sc.call("ping", {}), /sidecar failed to start|sidecar crashed/);
});
