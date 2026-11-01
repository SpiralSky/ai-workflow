import { mockProvenance } from "./provenance-fixture.ts";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runScheduler } from "../src/scheduler.ts";
import type { RunJSON } from "../src/types.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { boundEstimatedClient } from "../src/estimated.ts";
import { createDeepSeekClient } from "@aiw/llm";
import { resolveConfig, type EvalFlags } from "../src/config.ts";
import { frameworkLaunch } from "../src/framework-launch.ts";
const limits = { maxCalls: 3, maxTokens: 100, maxDurationMs: 30_000, estimateLimitUsd: 0.5 };
const req = { model: "deepseek-flash", system: "x", messages: [], tools: [] };
const result = () => ({ choices: [{ finish_reason: "stop", message: { content: "done", reasoning_content: "state" } }], usage: { prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 2, prompt_cache_miss_tokens: 8 } });
const flags: EvalFlags = { problems: "smoke", mode: "orchestrate", tools: "S", reps: 1, model: "deepseek-flash", temperature: 0, budget: 0.5, full: false, branchContext: "trace", secondaryCap: 4, provider: "deepseek", usageMode: "estimated", estimatedLimits: limits };
const registry = [{ id: "p", size: "smoke", set: "dev" }];
test("explicit provider/mode/limits and fixed model with credential-free host launch", () => {
  const config = resolveConfig(flags, registry);
  assert.equal(config.budgetUsd, null);
  assert.equal(frameworkLaunch("orchestrate", config).network, "none");
  const args = frameworkLaunch("orchestrate", config).executorArgs;
  assert.equal(args[args.indexOf("--executor-provider") + 1], "host");
  for (const change of [{ usageMode: "monetary" }, { estimatedLimits: undefined }, { model: "deepseek-v4-flash" }, { secondaryModel: "deepseek-v4-pro" }, { concurrency: 2 }]) assert.throws(() => resolveConfig({ ...flags, ...change } as EvalFlags, registry));
});
test("shared serial estimate gate preserves null actual dollars, cache and threshold overshoot", async () => {
  let calls = 0, active = 0, peak = 0;
  const client = createDeepSeekClient({ apiKey: "synthetic", now: () => Date.parse("2026-11-01T12:00:00Z"), fetch: (async () => {
    calls++; active++; peak = Math.max(peak, active); await new Promise(r => setTimeout(r, 2)); active--; return Response.json(result());
  }) as typeof fetch });
  const bounded = boundEstimatedClient(client, { ...limits, estimateLimitUsd: 0.000001 });
  const values = await Promise.allSettled([bounded.client.complete(req), bounded.client.complete(req)]);
  assert.equal(calls, 1); assert.equal(peak, 1); assert.equal(values[1]!.status, "rejected");
  assert.equal((values[0] as PromiseFulfilledResult<any>).value.costUsd, undefined);
  assert.ok(bounded.snapshot().knownEstimatedUsd > 0.000001);
  assert.equal(bounded.snapshot().cacheMissTokens, 8); assert.equal(bounded.snapshot().costBasis, "price-table-estimate");
});
test("each call rechecks offpeak and malformed accounting poisons next request", async () => {
  let now = Date.parse("2026-11-01T12:00:00Z"), calls = 0;
  const bounded = boundEstimatedClient(createDeepSeekClient({ apiKey: "synthetic", now: () => now, fetch: (async () => { calls++; return Response.json(result()); }) as typeof fetch }), limits);
  await bounded.client.complete(req); now = Date.parse("2026-11-02T02:00:00Z");
  await assert.rejects(bounded.client.complete(req), /off-peak/); now = Date.parse("2026-11-03T12:00:00Z");
  await assert.rejects(bounded.client.complete(req)); assert.equal(calls, 1); assert.equal(bounded.snapshot().estimatedUsd, null);
});

test("scheduler completes full mock matrix with unknown dollars only in explicit bounded estimated mode", async t => {
  const root = mkdtempSync(join(tmpdir(), "aiw-estimated-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = resolveConfig({ ...flags, mode: "compare" }, registry);
  const estimated = boundEstimatedClient(createDeepSeekClient({ apiKey: "synthetic", now: () => Date.parse("2026-11-01T12:00:00Z"), fetch: (async () => Response.json(result())) as typeof fetch }), limits);
  const run: RunJSON = { format: 1, id: "fixture", status: "in-progress", config,
    provenance: mockProvenance(config),
    totals: { jobs: 0, attempts: 0, costUsd: 0, pass: 0, fail: 0 }, startedAt: "fixture" };
  const invalid = await runScheduler({ config, estimated, jobs: config.frameworks.map(framework => ({ problem: "p", framework, rep: 0 })),
    runPath: root, repoRoot: root, apiKey: "", baseURL: "", problemsDir: root, turnLimits: {},
    runAttempt: async () => { await estimated.client.complete(req); return { outcome: "pass", reason: null, durationMs: 1,
      eventsPath: "fixture", costUsd: null, knownCostUsd: 0, costIncompleteReasons: ["missing-or-invalid-turn-cost"] }; },
  }, run);
  assert.equal(invalid, undefined); assert.equal(run.totals.jobs, 3); assert.equal(run.totals.pass, 3);
  assert.equal(run.totals.costUsd, null); assert.equal(run.estimatedUsage!.calls, 3);
});
