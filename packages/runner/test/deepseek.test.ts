import { mockProvenance } from "./provenance-fixture.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScheduler } from "../src/scheduler.ts";
import type { RunJSON } from "../src/types.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { createCostMeter } from "../src/cost-meter.ts";
import { createDeepSeekClient, PRICE_TABLE_VERSION } from "@aiw/llm";
import { resolveConfig, type EvalFlags } from "../src/config.ts";
import { frameworkLaunch } from "../src/framework-launch.ts";
const req = { model: "deepseek-flash", system: "x", messages: [], tools: [] };
const result = () => ({ choices: [{ finish_reason: "stop", message: { content: "done", reasoning_content: "state" } }], usage: { prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 2, prompt_cache_miss_tokens: 8 } });
const perCall = (8 * 0.15 + 2 * 0.003 + 5 * 0.6) / 1e6;
const flags: EvalFlags = { problems: "smoke", mode: "orchestrate", tools: "S", reps: 1, model: "deepseek-flash", temperature: 0, budget: 0.5, full: false, branchContext: "trace", secondaryCap: 4, provider: "deepseek" };
const registry = [{ id: "p", size: "smoke", set: "dev" }];
const offPeak = () => Date.parse("2026-11-01T12:00:00Z");
test("DeepSeek runs take the dollar budget, a fixed model and a credential-free host launch", () => {
  const config = resolveConfig(flags, registry);
  assert.equal(config.budgetUsd, 0.5);
  assert.equal(frameworkLaunch("orchestrate", config).network, "none");
  const args = frameworkLaunch("orchestrate", config).executorArgs;
  assert.equal(args[args.indexOf("--executor-provider") + 1], "host");
  for (const change of [{ budget: 0 }, { budget: NaN }, { model: "deepseek-v4-flash" }, { secondaryModel: "deepseek-v4-pro" }, { concurrency: 2 },
    { subscriptionLimits: { maxCalls: 1, maxTokens: 1, maxDurationMs: 1 } }]) assert.throws(() => resolveConfig({ ...flags, ...change } as EvalFlags, registry));
});
test("metered DeepSeek client adds price-table cost and closes admission at the budget", async () => {
  let calls = 0;
  const client = createDeepSeekClient({ apiKey: "synthetic", now: offPeak, fetch: (async () => { calls++; return Response.json(result()); }) as typeof fetch });
  const meter = createCostMeter(perCall * 1.5);
  const first = await meter.llm(client).complete(req);
  assert.equal(first.costUsd, perCall); assert.equal(first.costSource, "price-table"); assert.equal(first.priceTable, PRICE_TABLE_VERSION);
  // The second call's estimate (same size, learned cost per byte) would cross the budget, so it is never sent.
  await assert.rejects(meter.llm(client).complete(req), /budget/);
  assert.equal(calls, 1); assert.equal(meter.stopReason(), "budget"); assert.equal(meter.snapshot().knownCostUsd, perCall);
});
test("each call rechecks off-peak and a failed request poisons admission, keeping its cost", async () => {
  let now = offPeak(), calls = 0;
  const meter = createCostMeter(1);
  const client = meter.llm(createDeepSeekClient({ apiKey: "synthetic", now: () => now, fetch: (async () => { calls++; return Response.json(result()); }) as typeof fetch }));
  await client.complete(req); now = Date.parse("2026-11-02T02:00:00Z");
  await assert.rejects(client.complete(req), /off-peak/); now = Date.parse("2026-11-03T12:00:00Z");
  await assert.rejects(client.complete(req), /cost-incomplete/); assert.equal(calls, 1);
  assert.equal(meter.snapshot().incomplete, true); assert.equal(meter.snapshot().knownCostUsd, perCall);
});
test("missing or invalid cost poisons admission unless an unpriced plan run expects it", async () => {
  for (const bad of [{}, { costUsd: -1, costSource: "api" }, { costUsd: 1, costSource: "price-table" }, { costUsd: 1 }]) {
    const meter = createCostMeter(1);
    const client = meter.llm({ complete: async () => ({ response: {}, usage: { input: 1, output: 1 }, ...bad }) as any });
    await client.complete(req); await assert.rejects(client.complete(req), /cost-incomplete/);
  }
  const plan = createCostMeter(1, { costOptional: true });
  const client = plan.llm({ complete: async () => ({ response: {}, usage: { input: 1, output: 1 } }) });
  await client.complete(req); await client.complete(req);
  assert.equal(plan.stopReason(), undefined); assert.equal(plan.snapshot().costedCalls, 0);
});

test("scheduler records complete price-table cost for the DeepSeek matrix", async t => {
  const root = mkdtempSync(join(tmpdir(), "aiw-deepseek-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = resolveConfig({ ...flags, mode: "compare" }, registry);
  const llmClient = createDeepSeekClient({ apiKey: "synthetic", now: offPeak, fetch: (async () => Response.json(result())) as typeof fetch });
  const run: RunJSON = { format: 1, id: "fixture", status: "in-progress", config,
    provenance: mockProvenance(config),
    totals: { jobs: 0, attempts: 0, costUsd: 0, pass: 0, fail: 0 }, startedAt: "fixture" };
  const invalid = await runScheduler({ config, llmClient, jobs: config.frameworks.map(framework => ({ problem: "p", framework, rep: 0 })),
    runPath: root, repoRoot: root, apiKey: "", baseURL: "", problemsDir: root, turnLimits: {},
    runAttempt: async (opts) => { const c = await opts.llmClient!.complete(req); return { outcome: "pass", reason: null, durationMs: 1,
      eventsPath: "fixture", costUsd: c.costUsd!, knownCostUsd: c.costUsd! }; },
  }, run);
  assert.equal(invalid, undefined); assert.equal(run.totals.jobs, 3); assert.equal(run.totals.pass, 3);
  assert.ok(Math.abs(run.totals.costUsd! - 3 * perCall) < 1e-15);
});
