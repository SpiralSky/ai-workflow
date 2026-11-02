import test from "node:test";
import assert from "node:assert/strict";
import { createReporter, type EventRecord, type Sink } from "@aiw/telemetry";
import { TYPESAFE_MODEL, TYPESAFE_PRICE_BASIS, type DecisionsCompletion } from "@aiw/llm";
import { buildRegistry, classifierReranker, createSelector, createTaskScopedSelector, noneReranker } from "../src/index.ts";

/** Offline deterministic provider fixture: counters and charges are synthetic, not savings. */
function fixture(limits = {}) {
  const events: EventRecord[] = [];
  const reporter = createReporter({ writer: "r", sink: { write: e => events.push(e as EventRecord) } as Sink });
  const scope = { taskId: "task-one", stateRevision: "0", referenceRevision: "0", treatment: "mock/provider/model/policy-v1" };
  const catalog = buildRegistry(["read", "search", "edit"].map(name => ({ name, description: "file text",
    inputSchema: { type: "object" }, meta: { whenToUse: "file text", effect: "read" as const } })), { warn: () => {} }).decls;
  let calls = 0;
  let patch: Partial<DecisionsCompletion> = {};
  let action = async () => {};
  const selector = createSelector({ reranker: classifierReranker({ classify: async req => {
    calls++; await action(); return { answers: Object.fromEntries(req.candidates.map(c => [c.id, { type: "noul", noul: 0.9 }])),
      usage: { input: 10, output: 1 }, costUsd: 0.01, provider: "mock", providerModel: "typesafe/jev-1.14", ...patch };
  } }, { model: "typesafe/jev-1.14", threshold: 0.8, policy: "noul-v1" }) });
  const memo = createTaskScopedSelector({ selector, scope, ...limits });
  const query = (instruction = "file text") => ({ instruction, reporter, reuseScope: scope });
  return { events, reporter, scope, catalog, selector, memo, query, calls: () => calls,
    patch: (value: Partial<DecisionsCompletion>) => { patch = value; }, action: (value: () => Promise<void>) => { action = value; } };
}

test("predeclared repeated/unique/mutated corpus: exact equality, fewer synthetic calls, no duplicate billing", async t => {
  const corpus = ["file text", "file text", "search file", "edit file", "file text ", "file text"];
  const off = fixture(); const on = fixture();
  for (const instruction of corpus) {
    assert.deepEqual(await on.memo.select(on.query(instruction), on.catalog), await off.selector.select(off.query(instruction), off.catalog));
  }
  assert.equal(off.calls(), 6); assert.equal(on.calls(), 4);
  const turns = on.events.filter(e => e.kind === "turn");
  assert.equal(turns.length, 4); assert.equal(turns.reduce((s, e) => s + (e.costUsd ?? 0), 0), 0.04);
  assert.equal(on.events.filter(e => e.kind === "attach" && e.key === "selectionReuse").length, 2);
  t.diagnostic(JSON.stringify({ corpus, offCalls: 6, onCalls: 4, equal: true, unit: "synthetic call-count proxy; not monetary or task-success evidence" }));
});

test("state/reference/treatment/model/policy, catalog content/order/schema and exclusions invalidate", async () => {
  const f = fixture();
  const run = () => f.memo.select(f.query(), f.catalog);
  await run(); await run(); assert.equal(f.calls(), 1);
  for (const mutate of [() => f.scope.stateRevision = "1", () => f.scope.referenceRevision = "1",
    () => f.scope.treatment = "mock/new-model", () => f.scope.treatment = "mock/new-policy",
    () => f.catalog[0].meta.whenToUse += " changed", () => f.catalog.reverse(),
    () => f.catalog[0].parameters.required = ["path"]]) { const before = f.calls(); mutate(); await run(); assert.equal(f.calls(), before + 1); }
  const before = f.calls();
  function* names() { yield "read"; }
  const a = await f.memo.select({ ...f.query(), exclude: names() }, f.catalog);
  const b = await f.memo.select({ ...f.query(), exclude: names() }, f.catalog);
  assert.deepEqual(a, b); assert.ok(!a.stages.final.includes("read")); assert.equal(f.calls(), before + 1);
});

test("absent or different task ownership never reuses; changed owner rejected", async () => {
  const f = fixture();
  for (const reuseScope of [undefined, { ...f.scope, taskId: "other" }]) {
    await f.memo.select({ ...f.query(), reuseScope }, f.catalog); await f.memo.select({ ...f.query(), reuseScope }, f.catalog);
  }
  assert.equal(f.calls(), 4); f.scope.taskId = "other";
  await assert.rejects(f.memo.select(f.query(), f.catalog), /one task/);
});

test("unknown charges, provider, invalid usage, uncertain/fallback and failed answers never cache", async () => {
  for (const patch of [{ costUsd: undefined }, { usage: undefined }, { provider: undefined },
    { usage: { input: -1, output: 1 } }, { costUsd: NaN }, { answers: null },
    { answers: { c0: { type: "noul", noul: 0.5 }, c1: { type: "noul", noul: 0.5 }, c2: { type: "noul", noul: 0.5 } } },
    { failure: "infra" as const }]) {
    const f = fixture(); f.patch(patch);
    for (let i = 0; i < 2; i++) await f.memo.select(f.query(), f.catalog).catch(() => {});
    assert.equal(f.calls(), 2); assert.equal(f.events.filter(e => e.kind === "turn").length, 2);
    assert.ok(!f.events.some(e => e.kind === "attach" && e.key === "selectionReuse" && JSON.stringify(e).includes("task-local-hit")));
  }
});

test("abort before hit and after response fails; revision race not admitted; errors retry", async () => {
  const f = fixture(); await f.memo.select(f.query(), f.catalog);
  const early = new AbortController(); early.abort();
  await assert.rejects(f.memo.select({ ...f.query(), signal: early.signal }, f.catalog), /abort/i); assert.equal(f.calls(), 1);
  const late = new AbortController(); f.action(async () => late.abort());
  await assert.rejects(f.memo.select({ ...f.query("new file"), signal: late.signal }, f.catalog), /abort/i);
  assert.equal(f.events.filter(e => e.kind === "turn").length, 2);
  f.action(async () => { f.scope.referenceRevision += "1"; });
  await assert.rejects(f.memo.select(f.query("new file"), f.catalog), /revision changed/);
  f.action(async () => { throw Error("transport failed"); });
  await assert.rejects(f.memo.select(f.query("new file"), f.catalog), /transport failed/);
  f.action(async () => {}); await f.memo.select(f.query("new file"), f.catalog); assert.equal(f.calls(), 5);
});

test("bounded LRU, byte limit, defensive copying and dispose", async () => {
  const f = fixture({ maxEntries: 1 });
  const first = await f.memo.select(f.query(), f.catalog); first.tools[0].meta.whenToUse = "poison"; first.stages.final.length = 0;
  const next = await f.memo.select(f.query(), f.catalog); assert.notEqual(next.tools[0].meta.whenToUse, "poison"); assert.ok(next.stages.final.length);
  next.tools[0].parameters.changed = true;
  assert.equal((await f.memo.select(f.query(), f.catalog)).tools[0].parameters.changed, undefined);
  await f.memo.select(f.query("new file"), f.catalog); await f.memo.select(f.query(), f.catalog); assert.equal(f.calls(), 3);
  const tiny = fixture({ maxBytes: 1 }); await tiny.memo.select(tiny.query(), tiny.catalog); await tiny.memo.select(tiny.query(), tiny.catalog); assert.equal(tiny.calls(), 2);
  f.memo.dispose(); await assert.rejects(f.memo.select(f.query(), f.catalog), /disposed/);
});

test("concurrent calls are not shared and custom/unverified selectors fail closed", async () => {
  const f = fixture(); let release!: () => void;
  f.action(() => new Promise<void>(resolve => { release = resolve; }));
  const pending = f.memo.select(f.query(), f.catalog);
  await assert.rejects(f.memo.select(f.query(), f.catalog), /Concurrent/); release(); await pending; assert.equal(f.calls(), 1);
  let calls = 0; const plain = createSelector({ reranker: noneReranker });
  const memo = createTaskScopedSelector({ scope: f.scope, selector: { async select(q, c) { calls++; return plain.select(q, c); } } });
  await memo.select(f.query(), f.catalog); await memo.select(f.query(), f.catalog); assert.equal(calls, 2);
});

test("immutable pipeline configuration and fresh wrapper isolation across K/N/model/threshold", async () => {
  const f = fixture(); let calls = 0;
  for (const configuration of [
    { model: "typesafe/jev-1.14", threshold: 0.8, k: 20, n: 6 },
    { model: "typesafe/jev-1.14", threshold: 0.9, k: 20, n: 6 },
    { model: "microsoft/microsoft-decision-1", threshold: 0.8, k: 20, n: 6 },
    { model: "typesafe/jev-1.14", threshold: 0.8, k: 2, n: 1 },
  ]) {
    const model = configuration.model;
    const options = { ...configuration, policy: "noul-v1" as const };
    const reranker = classifierReranker({ classify: async req => {
      calls++; return { answers: Object.fromEntries(req.candidates.map(c => [c.id, { type: "noul", noul: 0.95 }])),
        usage: { input: 10, output: 1 }, costUsd: 0.01, provider: "mock", providerModel: model };
    } }, options);
    const pipeline = { reranker, k: configuration.k, n: configuration.n };
    const selector = createSelector(pipeline);
    const memo = createTaskScopedSelector({ selector, scope: f.scope });
    options.model = "mutated"; options.threshold = 1; pipeline.reranker = noneReranker; pipeline.n = 0;
    const before = calls;
    const first = await memo.select(f.query(), f.catalog); const second = await memo.select(f.query(), f.catalog);
    assert.deepEqual(first, second); assert.equal(calls, before + 1);
    assert.equal(first.tools.length, Math.min(configuration.n, configuration.k, f.catalog.length));
  }
});

test("in-flight input mutation is isolated; disposal blocks admission; override bypasses reuse", async () => {
  const f = fixture(); const q = f.query();
  f.action(async () => { q.instruction = "mutated"; f.catalog[0].meta.whenToUse = "mutated"; });
  const result = await f.memo.select(q, f.catalog);
  assert.ok(result.tools.every(d => d.meta.whenToUse !== "mutated"));
  f.action(async () => f.memo.dispose());
  await assert.rejects(f.memo.select(f.query("new file"), f.catalog), /disposed/);
  const other = fixture();
  for (let i = 0; i < 2; i++) await other.memo.select({ ...other.query(), override: ["read"] }, other.catalog);
  assert.equal(other.calls(), 0);
  assert.equal(other.events.filter(e => e.kind === "attach" && e.key === "selectionReuse").length, 0);
});

test("failure attachments do not duplicate secret-bearing thrown content", async () => {
  const f = fixture(); const sentinel = "SENTINEL_SECRET_DO_NOT_LOG_9876";
  const failure = new Error(`provider error: credential=${sentinel}`);
  f.action(async () => { throw failure; });
  await assert.rejects(f.memo.select(f.query(), f.catalog), error => error === failure);
  assert.ok(f.events.some(e => e.kind === "attach" && e.key === "selectionReuse"));
  assert.ok(!JSON.stringify(f.events).includes(sentinel));
});

test("observed A to B to A revision and treatment transitions cannot revive old entries", async () => {
  for (const field of ["stateRevision", "referenceRevision", "treatment"] as const) {
    const f = fixture();
    for (const token of ["A", "B", "A"]) {
      f.scope[field] = token;
      const before = f.calls();
      await f.memo.select(f.query(), f.catalog); assert.equal(f.calls(), before + 1);
      await f.memo.select(f.query(), f.catalog); assert.equal(f.calls(), before + 1);
    }
    assert.equal(f.calls(), 3);
  }
});

test("post-await observed transition also drops previously cached partition", async () => {
  const f = fixture(); f.scope.stateRevision = "A";
  await f.memo.select(f.query(), f.catalog);
  f.action(async () => { f.scope.stateRevision = "B"; });
  await assert.rejects(f.memo.select(f.query("unique file"), f.catalog), /revision changed/);
  f.scope.stateRevision = "A"; f.action(async () => {});
  await f.memo.select(f.query(), f.catalog); assert.equal(f.calls(), 3);
});

test("bypass calls observe owned scope transitions and cannot revive an old partition", async () => {
  const f = fixture(); f.scope.stateRevision = "A";
  await f.memo.select(f.query(), f.catalog);
  f.scope.stateRevision = "B";
  await f.memo.select({ ...f.query(), reuseScope: undefined }, f.catalog);
  f.scope.stateRevision = "A";
  await f.memo.select(f.query(), f.catalog); assert.equal(f.calls(), 3);
});

test("verified TypeSafe estimate-only successes admit; invalid estimates never admit", async () => {
  for (const valid of [true, false]) {
    const f = fixture(); let calls = 0;
    const selector = createSelector({ reranker: classifierReranker({ classify: async req => {
      calls++;
      return { provider: "TypeSafe", providerModel: TYPESAFE_MODEL,
        answers: Object.fromEntries(req.candidates.map(c => [c.id, { type: "noul", noul: 0.9 }])),
        usage: { input: 10, output: 1 }, classifierEstimate: { basis: TYPESAFE_PRICE_BASIS,
          inputTokens: 10, outputTokens: 1, estimatedUsd: valid ? 10 * 0.042 / 1e6 : 999 } };
    } }, { model: TYPESAFE_MODEL, threshold: 0.8, policy: "noul-v1" }) });
    const memo = createTaskScopedSelector({ selector, scope: f.scope });
    if (valid) {
      assert.deepEqual(await memo.select(f.query(), f.catalog), await memo.select(f.query(), f.catalog));
      assert.equal(calls, 1);
      const turns = f.events.filter(e => e.kind === "turn"); assert.equal(turns.length, 1);
      assert.equal(turns[0].costUsd, undefined);
      assert.equal(turns[0].classifierEstimate?.estimatedUsd, 10 * 0.042 / 1e6);
      assert.ok(f.events.some(e => e.kind === "attach" && e.key === "selectionReuse" && JSON.stringify(e).includes("task-local-hit")));
    } else {
      await assert.rejects(memo.select(f.query(), f.catalog), /accounting incomplete/i);
      await assert.rejects(memo.select(f.query(), f.catalog), /accounting incomplete/i);
      assert.equal(calls, 2); assert.equal(f.events.filter(e => e.kind === "turn").length, 2);
      assert.ok(!f.events.some(e => e.kind === "attach" && e.key === "selectionReuse" && JSON.stringify(e).includes("task-local-hit")));
    }
  }
});

test("malformed JavaScript scope identities fail before provider execution", async () => {
  for (const field of ["taskId", "stateRevision", "referenceRevision", "treatment"] as const) {
    for (const malformed of [1, {}, "", null, undefined]) {
      const f = fixture();
      (f.scope as unknown as Record<string, unknown>)[field] = malformed;
      await assert.rejects(f.memo.select(f.query(), f.catalog), /explicit nonempty revisions\/treatment/);
      assert.equal(f.calls(), 0);
    }
  }
  const f = fixture();
  const malformed = { ...f.scope, taskId: 1 } as unknown as typeof f.scope;
  const memo = createTaskScopedSelector({ selector: f.selector, scope: malformed });
  await assert.rejects(memo.select({ ...f.query(), reuseScope: malformed }, f.catalog), /explicit nonempty revisions\/treatment/);
  assert.equal(f.calls(), 0);
});
