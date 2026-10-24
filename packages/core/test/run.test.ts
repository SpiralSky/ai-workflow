import test from "node:test";
import assert from "node:assert/strict";
import { runBranch as runWith } from "../src/branch/run.ts";
import { engine, runtime } from "./engine.ts";
import { selectRuntime } from "../src/branch/index.ts";
import type { BranchTools, CompiledBranch, TraceEvent } from "../src/branch/types.ts";

/** Hand-written compiled program: identity line map (js line N is original line N). */
/** `runBranch` on the engine under test. */
const runBranch = (p: CompiledBranch, t: BranchTools, s: Record<string, unknown>, o: Parameters<typeof runWith>[3] = {}) => runWith(p, t, s, o, runtime);
const prog = (js: string): CompiledBranch => ({ js, lineMap: js.split("\n").map((_, i) => i + 1) });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tools: BranchTools = {
  echo: (a) => a,
  slow: async (a) => {
    await sleep(Number(a.ms));
    return { ms: a.ms, at: Date.now() };
  },
  boom: () => {
    throw Object.assign(new Error("kaput"), { name: "BoomError" });
  },
};
const calls = (t: TraceEvent[]) => t.filter((e) => e.type === "call");

test("sequential calls record start/end pairs with original lines", async () => {
  const r = await runBranch(prog(`async (tools, state) => {
  const a = await tools.echo({ x: 1 });
  const b = await tools.echo({ y: 2 });
  return [a, b];
}`), tools, {});
  assert.ok(r.ok);
  assert.deepEqual(r.value, [{ x: 1 }, { y: 2 }]);
  const starts = r.trace.filter((e) => e.type === "call" && e.phase === "start");
  assert.deepEqual(starts.map((e: any) => [e.id, e.line, e.name, e.args]), [[1, 2, "echo", { x: 1 }], [2, 3, "echo", { y: 2 }]]);
  const ends = r.trace.filter((e) => e.type === "call" && e.phase === "end");
  assert.deepEqual(ends.map((e: any) => [e.id, e.ok, e.result]), [[1, true, { x: 1 }], [2, true, { y: 2 }]]);
});

test("Promise.all runs tools concurrently", async () => {
  const t0 = Date.now();
  const r = await runBranch(prog(`async (tools) => {
  return Promise.all([tools.slow({ ms: 300 }), tools.slow({ ms: 300 }), tools.slow({ ms: 300 })]);
}`), tools, {});
  assert.ok(r.ok);
  assert.ok(Date.now() - t0 < 800, "calls overlapped");
  const starts = calls(r.trace).filter((e: any) => e.phase === "start") as any[];
  assert.deepEqual(starts.map((e) => e.line), [2, 2, 2]);
  assert.ok(starts[2].t < 200);
});

test("tool error caught by the program is recorded as a failed call", async () => {
  const r = await runBranch(prog(`async (tools) => {
  try {
    await tools.boom({});
  } catch (e) {
    return e.name + "/" + e.message;
  }
}`), tools, {});
  assert.ok(r.ok);
  assert.equal(r.value, "BoomError/kaput");
  const end = calls(r.trace).find((e: any) => e.phase === "end") as any;
  assert.equal(end.ok, false);
  assert.equal(end.error, "kaput");
});

test("uncaught tool error: error event names the tool and line", async () => {
  const r = await runBranch(prog(`async (tools) => {
  await tools.echo({});
  await tools.boom({});
}`), tools, {});
  assert.ok(!r.ok);
  assert.equal(r.error, "thrown");
  assert.equal(r.line, 3);
  assert.equal(r.message, "BoomError: kaput");
  const e = r.trace.at(-1) as any;
  assert.equal(e.type, "error");
  assert.deepEqual([e.tool, e.callId, e.lines], ["boom", 2, [3]]);
});

test("unknown tool throws with the available names", async () => {
  const r = await runBranch(prog(`async (tools) => {
  try { await tools.nope({}); } catch (e) { return e.message; }
}`), tools, {});
  assert.ok(r.ok);
  assert.equal(r.value, "unknown tool: nope (available: echo, slow, boom)");
  assert.equal((calls(r.trace)[1] as any).ok, false);
});

test("throws of non-Error values and plain errors are reported with the innermost line", async () => {
  const a = await runBranch(prog(`async () => {\n  throw "plain";\n}`), tools, {});
  assert.ok(!a.ok && a.error === "thrown" && a.message === "plain" && a.line === undefined);
  const b = await runBranch(prog(`async () => {
  const f = () => {
    null.x;
  };
  f();
}`), tools, {});
  assert.ok(!b.ok);
  assert.equal(b.line, 3);
  assert.deepEqual((b.trace.at(-1) as any).lines, [3, 5]);
});

test("console methods become log events with lines", async () => {
  const r = await runBranch(prog(`async () => {
  console.log("hi", { a: 1 }, 2);
  console.warn("w");
  console.error(new Error("e"));
}`), tools, {});
  assert.ok(r.ok);
  assert.deepEqual(r.trace.map((e: any) => [e.type, e.line, e.level, e.message]), [
    ["log", 2, "log", 'hi {"a":1} 2'], ["log", 3, "warn", "w"], ["log", 4, "error", "Error: e"],
  ]);
});

test("instrumentation hooks record events and pass values through", async () => {
  const r = await runBranch(prog(`async (tools, state) => {
  if (__t.cond(2, "if", 0, 5, 6)) { return 1; }
  __t.loopEnter(3, "for", 4); __t.loopIter(3); __t.loopExit(3);
  __t.case(5, 1, 2);
  return __t.ret(6, { v: [1, () => 2] });
}`), tools, {});
  assert.ok(r.ok);
  assert.deepEqual(r.value, { v: [1, null] });
  assert.deepEqual(r.trace.map((e: any) => [e.type, e.phase ?? e.kind, e.value]), [
    ["cond", "if", false], ["loop", "enter", undefined], ["loop", "iter", undefined], ["loop", "exit", undefined],
    ["cond", "switch", true], ["return", undefined, { v: [1, null] }],
  ]);
  assert.ok(r.trace.every((e) => typeof e.t === "number"));
});

test("state write-back replaces, deletes and drops unserialisable keys", async () => {
  const state: Record<string, unknown> = { keep: 1, gone: 2, replaced: { a: 1 }, fn: "old", cyc: "old" };
  const r = await runBranch(prog(`async (tools, state) => {
  state.added = [1, 2];
  state.replaced = { b: 2 };
  delete state.gone;
  state.fn = { nested: () => 1 };
  const c = {}; c.self = c; state.cyc = c;
  state.undef = undefined;
}`), tools, state);
  assert.ok(r.ok);
  assert.deepEqual(r.droppedKeys?.sort(), ["cyc", "fn"]);
  assert.deepEqual(state, { keep: 1, replaced: { b: 2 }, added: [1, 2] });
});

test("state is written back when the branch throws", async () => {
  const state: Record<string, unknown> = {};
  const r = await runBranch(prog(`async (tools, state) => {\n  state.n = 5;\n  throw new Error("x");\n}`), tools, state);
  assert.ok(!r.ok);
  assert.deepEqual(state, { n: 5 });
});

test("timeout reverts state to the last tool-call snapshot", async () => {
  const state: Record<string, unknown> = { n: 0 };
  const r = await runBranch(prog(`async (tools, state) => {
  state.n = 1;
  await tools.echo({});
  state.n = 2;
  await tools.slow({ ms: 5000 });
}`), tools, state, { timeoutMs: 300 });
  assert.ok(!r.ok);
  assert.equal(r.error, "timeout");
  assert.equal(r.aborted, true);
  assert.equal(r.stateReverted, true);
  assert.equal(state.n, 2); // the slow call's snapshot already carried n = 2
  const end = calls(r.trace).at(-1) as any;
  assert.deepEqual([end.phase, end.ok, end.aborted], ["end", false, true]);
});

test("revert drops changes made after the last tool call", async () => {
  const state: Record<string, unknown> = { n: 0 };
  const r = await runBranch(prog(`async (tools, state) => {
  state.n = 1;
  await tools.echo({});
  state.n = 2;
  while (true) {}
}`), tools, state, { timeoutMs: 300 });
  assert.ok(!r.ok && r.error === "timeout" && r.stateReverted);
  assert.equal(state.n, 1);
});

test("abort via signal marks the in-flight call and aborts ctx.signal", async () => {
  const ac = new AbortController();
  let ctxSignal: AbortSignal | undefined;
  const t: BranchTools = {
    hang: (_a, ctx) => {
      ctxSignal = ctx.signal;
      setTimeout(() => ac.abort(), 50);
      return new Promise(() => {});
    },
  };
  const r = await runBranch(prog(`async (tools) => {\n  await tools.hang({});\n}`), t, {}, { signal: ac.signal });
  assert.ok(!r.ok);
  assert.equal(r.error, "aborted");
  assert.equal(r.aborted, true);
  assert.equal(ctxSignal?.aborted, true);
  assert.deepEqual(calls(r.trace).map((e: any) => [e.phase, e.aborted]), [["start", undefined], ["end", true]]);
});

test("pauseTimeout excludes paused time, nested and concurrent", async () => {
  const t: BranchTools = {
    approve: async (a, ctx) => {
      const resume = ctx.pauseTimeout();
      const r2 = ctx.pauseTimeout();
      await sleep(Number(a.ms));
      resume();
      r2();
      return "ok";
    },
  };
  const ok = await runBranch(prog(`async (tools) => Promise.all([tools.approve({ ms: 600 }), tools.approve({ ms: 700 })])`), t, {}, { timeoutMs: 300 });
  assert.ok(ok.ok, "paused time not counted");
  const bad = await runBranch(prog(`async (tools) => { await tools.slow({ ms: 600 }); }`), tools, {}, { timeoutMs: 300 });
  assert.ok(!bad.ok && bad.error === "timeout");
});

test("memory limit kills the branch and reverts state", async () => {
  const state = { n: 1 };
  const r = await runBranch(prog(`async (tools, state) => {
  state.n = 2;
  const a = [];
  while (true) a.push(new Array(100000).fill(1));
}`), tools, state, { memoryMb: 16 });
  assert.ok(!r.ok);
  assert.equal(r.error, "memory");
  assert.equal(r.stateReverted, true);
  assert.equal(state.n, 1);
});

test("onEvent receives every event; a throwing onEvent is ignored", async () => {
  const seen: TraceEvent[] = [];
  const r = await runBranch(prog(`async () => {
  for (let i = 0; i < 600; i++) console.log(i);
  return 1;
}`), tools, {}, { onEvent: (e) => { seen.push(e); throw new Error("observer"); } });
  assert.ok(r.ok);
  assert.equal(seen.length, 600); // flushed in batches of 256 plus the final batch
  assert.deepEqual(seen, r.trace);
});

test("the isolate has no require, process or host globals", async () => {
  const r = await runBranch(prog(`async () => [typeof require, typeof process, typeof module, typeof __host, typeof __callRef]`), tools, {});
  assert.ok(r.ok);
  assert.deepEqual(r.value, Array(5).fill("undefined"));
});

test("synchronous infinite loop times out (timers are starved on host-thread engines)", async () => {
  const t0 = Date.now();
  const r = await runBranch(prog(`async () => {\n  for (;;) {}\n}`), tools, {}, { timeoutMs: 300 });
  assert.ok(!r.ok && r.error === "timeout" && r.aborted === true && r.stateReverted === true);
  assert.ok(Date.now() - t0 < 3000);
});

test("a program cannot catch or swallow the timeout", async () => {
  const state = { n: 0 };
  const r = await runBranch(prog(`async (tools, state) => {
  state.n = 1;
  for (let i = 0; i < 3; i++) {
    try { while (true) {} } catch (e) { state.n = 99; } finally { state.n = 98; }
  }
  return "survived";
}`), tools, state, { timeoutMs: 300 });
  assert.ok(!r.ok && r.error === "timeout");
  assert.equal(state.n, 0);
});

test("a timeout during a tool call's aftermath loop still reports partial trace", async () => {
  const r = await runBranch(prog(`async (tools) => {\n  await tools.echo({});\n  while (true) {}\n}`), tools, {}, { timeoutMs: 300 });
  assert.ok(!r.ok && r.error === "timeout");
  assert.ok(calls(r.trace).length >= 1); // events still buffered in the isolate at kill time are lost (engine-dependent)
});

test("out of memory maps to the memory error even when the program catches it", async () => {
  const state = { n: 1 };
  const r = await runBranch(prog(`async (tools, state) => {
  state.n = 2;
  const a = [];
  try { while (true) a.push(new Array(100000).fill(1)); } catch (e) { throw e; }
}`), tools, state, { memoryMb: 8 });
  assert.ok(!r.ok);
  assert.equal(r.error, "memory");
  assert.equal(state.n, 1);
});

test("dispose while host calls are pending is safe", async () => {
  const r = await runBranch(prog(`async (tools) => Promise.all([tools.slow({ ms: 400 }), tools.slow({ ms: 400 })])`), tools, {}, { timeoutMs: 100 });
  assert.ok(!r.ok && r.error === "timeout");
  await sleep(600); // late host resolutions must be ignored
});

test("selectRuntime: quickjs is always available; auto falls back with a note without --no-node-snapshot", async () => {
  assert.equal((await selectRuntime("quickjs")).engine, "quickjs");
  const auto = await selectRuntime("auto");
  const flagged = process.execArgv.includes("--no-node-snapshot") || /--no-node-snapshot/.test(process.env.NODE_OPTIONS ?? "");
  if (flagged) assert.equal(auto.engine, "isolated-vm");
  else {
    assert.equal(auto.engine, "quickjs");
    assert.match(auto.note ?? "", /--no-node-snapshot/);
    await assert.rejects(selectRuntime("isolated-vm"), /isolated-vm/);
  }
  assert.ok(["quickjs", "isolated-vm"].includes(engine.engine));
});
