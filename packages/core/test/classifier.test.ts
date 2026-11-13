import test from "node:test";
import assert from "node:assert/strict";
import { createReporter, type EventRecord, type Sink } from "@aiw/telemetry";
import { buildRegistry, classifierReranker, createSelector, validateClassifierPolicy } from "../src/index.ts";
import type { DecisionsClient } from "@aiw/llm";
const catalog = buildRegistry(["edit", "read", "search"].map(name => ({ name, description: "file text", inputSchema: {}, meta: {
  whenToUse: "file text", effect: "read" as const, ...(name === "edit" ? { requires: ["read"] } : {}),
} })), { warn: () => {} }).decls;
const opts = { model: "typesafe/jev-1.14", threshold: 0.8, policy: "noul-v1" as const };
function fixture(client: DecisionsClient) {
  const events: EventRecord[] = [];
  const reporter = createReporter({ sink: { write: e => events.push(e as EventRecord) } as Sink, writer: "r" });
  return { events, reporter, reranker: classifierReranker({ classify: async req => ({ providerModel: opts.model, ...await client.classify(req) }) }, opts) };
}

test("typed probabilities preserve confident ranking, stable ties and required dependencies", async () => {
  const f = fixture({ classify: async req => ({ answers: Object.fromEntries(req.candidates.map(c => [c.id, { type: "noul", noul: c.name === "read" ? 0.1 : 0.9 }])), usage: { input: 10, output: 1 }, costUsd: 0.02, costSource: "api" as const }) });
  const result = await createSelector({ reranker: f.reranker, n: 1 }).select({ instruction: "file text", reporter: f.reporter }, catalog);
  assert.deepEqual(result.stages.final, ["edit", "read"]);
  assert.equal(result.stages.rerankFallback, undefined);
  assert.equal(f.events.filter(e => e.kind === "turn").length, 1);
  assert.equal(f.events.find(e => e.kind === "turn")?.costUsd, 0.02);
});

for (const [answer, reason] of [[null, "malformed-answer"], [{ type: "noul", noul: 0.5 }, "uncertain-probability"], [{ type: "noul", noul: 0 }, "no-confident-positive"]] as const) {
  test(`classifier ${reason} preserves candidate set and reports billed fallback without another call`, async () => {
    let calls = 0;
    const f = fixture({ classify: async req => { calls++; return { answers: answer ? Object.fromEntries(req.candidates.map(c => [c.id, answer])) : null, usage: { input: 10, output: 2 }, costUsd: 0.03, costSource: "api" as const }; } });
    const ctx = { reporter: f.reporter, fallback: false, fallbackReason: undefined as string | undefined };
    assert.deepEqual(await f.reranker.rerank("file text", catalog, ctx), catalog);
    assert.equal(ctx.fallbackReason, reason); assert.equal(ctx.fallback, true); assert.equal(calls, 1);
    assert.equal(f.events.filter(e => e.kind === "turn").length, 1);
    assert.ok(f.events.some(e => e.kind === "attach" && e.key === "classifierSelection"));
  });
}
test("unknown usage remains missing while known billed charge is retained", async () => {
  const f = fixture({ classify: async () => ({ answers: null, costUsd: 0.04, costSource: "api" as const }) });
  await assert.rejects(f.reranker.rerank("file", catalog, { reporter: f.reporter }), /accounting incomplete/);
  const event = f.events.find(e => e.kind === "turn")!;
  assert.equal(event.usage, undefined); assert.equal(event.costUsd, 0.04);
});
test("invalid thresholds and pre-cancelled selections make no calls", async () => {
  for (const value of [NaN, 0, 0.5, 1.1]) assert.throws(() => validateClassifierPolicy(value, "noul-v1"));
  assert.throws(() => validateClassifierPolicy(0.8, "guessed-v2"));
  let calls = 0;
  const f = fixture({ classify: async () => { calls++; throw new Error("must not call"); } });
  const control = new AbortController(); control.abort();
  await assert.rejects(f.reranker.rerank("file", catalog, { reporter: f.reporter, signal: control.signal }));
  assert.equal(calls, 0);
});

test("classifier failure and missing cost stop before any executor work, preserving charge telemetry", async () => {
  for (const result of [{ answers: null, usage: { input: 10, output: 1 }, costUsd: 0.2, costSource: "api" as const, failure: "infra" as const },
    { answers: null, usage: { input: 10, output: 1 } }]) {
    const f = fixture({ classify: async () => result });
    await assert.rejects(f.reranker.rerank("file", catalog, { reporter: f.reporter }), /failed|incomplete/);
    assert.equal(f.events.filter(e => e.kind === "turn").length, 1);
    assert.equal(f.events.find(e => e.kind === "turn")?.costUsd, result.costUsd);
  }
});

test("missing or mismatched observed classifier model stops after recording billed usage", async () => {
  for (const providerModel of [undefined, "microsoft/microsoft-decision-1"]) {
    const f = fixture({ classify: async () => ({ providerModel, answers: null, usage: { input: 10, output: 1 }, costUsd: 0.1, costSource: "api" as const }) });
    await assert.rejects(f.reranker.rerank("file", catalog, { reporter: f.reporter }), /observation missing or mismatched/);
    const turn = f.events.find(e => e.kind === "turn")!;
    assert.equal(turn.costUsd, 0.1); assert.equal(turn.providerModel, providerModel);
  }
});

test("actual orchestrate classifier treatment uses typed selection, not chat reranking", async t => {
  const { mkdtempSync, rmSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { tmpdir } = await import("node:os");
  const { buildFramework } = await import("../src/index.ts");
  const root = mkdtempSync(join(tmpdir(), "aiw-classifier-workflow-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  let classifications = 0, executorCalls = 0;
  const f = fixture({ classify: async req => { classifications++; return { providerModel: opts.model,
    answers: Object.fromEntries(req.candidates.map(c => [c.id, { type: "noul", noul: 0.9 }])), usage: { input: 10, output: 1 }, costUsd: 0.02, costSource: "api" as const }; } });
  const declarations = [{ name: "read", description: "read file", inputSchema: {}, meta: { whenToUse: "read file", effect: "read" as const } }];
  const framework = buildFramework("orchestrate", buildRegistry(declarations), { variant: { rerank: "classifier" },
    host: { tools: async () => declarations, call: async () => "fixture", close: async () => {} },
    orchestrate: { workspaceRoot: root, model: "executor", classifier: { ...opts, client: { classify: async req => {
      classifications++; return { providerModel: opts.model, answers: Object.fromEntries(req.candidates.map(c => [c.id, { type: "noul", noul: 0.9 }])), usage: { input: 10, output: 1 }, costUsd: 0.02, costSource: "api" as const };
    } } }, client: { complete: async req => { executorCalls++; assert.equal(req.model, "executor"); return {
      response: { choices: [{ message: { content: "Task completed" } }] }, usage: { input: 5, output: 2 }, costUsd: 0.03,
    }; } } },
  });
  const result = await framework.tools.find(tool => tool.name === "do")!.handle({ instruction: "read file" }, { reporter: f.reporter });
  assert.equal(result.isError, false, result.text); assert.equal(classifications, 1); assert.equal(executorCalls, 1);
  const turns = f.events.filter(e => e.kind === "turn");
  assert.deepEqual(turns.map(e => [e.role, e.model, e.costUsd]), [["selection", opts.model, 0.02], ["secondary", "executor", 0.03]]);
});
