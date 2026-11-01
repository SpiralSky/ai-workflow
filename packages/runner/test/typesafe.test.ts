import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTypeSafeDecisionsClient, createDeepSeekClient, TYPESAFE_MODEL } from "@aiw/llm";
import { boundClassifierEstimatedClient } from "../src/classifier-estimated.ts";
import { boundEstimatedClient } from "../src/estimated.ts";
import { resolveConfig, type EvalFlags } from "../src/config.ts";
import { frameworkLaunch } from "../src/framework-launch.ts";
import { runScheduler } from "../src/scheduler.ts";
import { mockProvenance } from "./provenance-fixture.ts";
import type { RunJSON } from "../src/types.ts";
const req = { instruction: "read file", candidates: [{ id: "c0", name: "read", whenToUse: "read file" }] };
const limits = { maxCalls: 5, maxTokens: 10000, maxDurationMs: 30000, estimateLimitUsd: 1 };
const flags: EvalFlags = { problems: "p", mode: "orchestrate[rerank=classifier]", tools: "S", reps: 1, model: "deepseek-flash", temperature: 0, budget: 1, full: false, branchContext: "trace", secondaryCap: 4,
  provider: "deepseek", usageMode: "estimated", estimatedLimits: limits, classifierProvider: "typesafe", classifierModel: TYPESAFE_MODEL, classifierThreshold: 0.8, classifierLimits: limits };
const result = () => ({ model: TYPESAFE_MODEL, answers: { c0: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 100, output_tokens: 10 } });
const direct = (body = result()) => createTypeSafeDecisionsClient({ apiKey: "SYNTHETIC", model: TYPESAFE_MODEL, fetch: (async () => Response.json(body)) as typeof fetch });
test("explicit direct classifier contract and no OpenRouter dependency", () => {
  const config = resolveConfig(flags, []); assert.equal(config.classifier!.provider, "typesafe");
  assert.equal(frameworkLaunch(config.frameworks[0]!, config).network, "none");
  for (const change of [{ classifierLimits: undefined }, { classifierModel: "jev-latest" }, { provider: "chatgpt", usageMode: "subscription" }, { classifierProvider: "openrouter-decisions" }]) assert.throws(() => resolveConfig({ ...flags, ...change } as EvalFlags, []));
});
test("classifier campaign gate serializes and counts across calls, never per-attempt reset", async () => {
  let active = 0, peak = 0, calls = 0;
  const client = direct(); const bounded = boundClassifierEstimatedClient({ classify: async r => { calls++; active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 2)); active--; return client.classify(r); } }, { ...limits, maxCalls: 2 });
  const values = await Promise.allSettled([1, 2, 3].map(() => bounded.client.classify(req)));
  assert.equal(values[2]!.status, "rejected"); assert.equal(calls, 2); assert.equal(peak, 1);
  assert.equal(bounded.snapshot().calls, 2); assert.equal(bounded.snapshot().inputTokens, 200);
  assert.equal(bounded.snapshot().knownEstimatedUsd, 200 * 0.042 / 1e6); assert.equal(bounded.stopReason(), "classifier-call-limit");
});
test("malformed billed answer remains estimated; unknown subsequent usage poisons admission retaining subtotal", async () => {
  let calls = 0;
  const client = createTypeSafeDecisionsClient({ apiKey: "x", model: TYPESAFE_MODEL, fetch: (async () => Response.json(++calls === 1 ? { ...result(), answers: {} } : { ...result(), usage: {} })) as typeof fetch });
  const bounded = boundClassifierEstimatedClient(client, limits);
  assert.equal((await bounded.client.classify(req)).answers, null);
  const known = bounded.snapshot().knownEstimatedUsd; assert.ok(known > 0);
  await bounded.client.classify(req); await assert.rejects(bounded.client.classify(req));
  assert.equal(calls, 2); assert.equal(bounded.snapshot().estimatedUsd, null); assert.equal(bounded.snapshot().knownEstimatedUsd, known);
});
test("scheduler sums complete provider estimates per task without claiming actual dollars", async t => {
  const root = mkdtempSync(join(tmpdir(), "aiw-typesafe-scheduler-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = resolveConfig({ ...flags, mode: "baseline,orchestrate[rerank=classifier]" }, []);
  const estimated = boundEstimatedClient(createDeepSeekClient({ apiKey: "synthetic", now: () => Date.parse("2026-11-01T12:00:00Z"), fetch: (async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "done", reasoning_content: "opaque" } }], usage: { prompt_tokens: 10, completion_tokens: 2, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10 } })) as typeof fetch }), limits);
  const classifierEstimated = boundClassifierEstimatedClient(direct(), limits);
  const run: RunJSON = { format: 1, id: "fixture", status: "in-progress", config, provenance: mockProvenance(config), totals: { jobs: 0, attempts: 0, costUsd: null, pass: 0, fail: 0 }, startedAt: "fixture" };
  const jobResults: any[] = [];
  const invalid = await runScheduler({ config, estimated, classifierEstimated, jobs: config.frameworks.map(framework => ({ problem: "p", framework, rep: 0 })), runPath: root, repoRoot: root, apiKey: "", baseURL: "", problemsDir: root, turnLimits: {},
    onJobDone: (_job, result) => { jobResults.push(result); }, runAttempt: async ({ job }) => {
      await estimated.client.complete({ model: "deepseek-flash", system: "fixture", messages: [], tools: [] }); if (job.framework.includes("classifier")) await classifierEstimated.client.classify(req);
      return { outcome: "pass", reason: null, durationMs: 1, eventsPath: "fixture", costUsd: null, knownCostUsd: 0, costIncompleteReasons: ["missing-or-invalid-turn-cost"] };
    } }, run);
  assert.equal(invalid, undefined); assert.equal(run.totals.costUsd, null); assert.equal(run.classifierEstimatedUsage!.calls, 1);
  assert.equal(jobResults[0].estimatedCostComponents.typesafe.estimatedUsd, 0);
  assert.equal(jobResults[1].estimatedCostComponents.deepseek.estimatedUsd, jobResults[0].estimatedCostComponents.deepseek.estimatedUsd);
  const jobResult = jobResults[1]; const c = jobResult.estimatedCostComponents; assert.ok(c.deepseek.estimatedUsd > 0 && c.typesafe.estimatedUsd > 0);
  assert.equal(jobResult.estimatedCost.estimatedUsd, c.deepseek.estimatedUsd + c.typesafe.estimatedUsd);
  assert.match(jobResult.estimatedCost.basis, /typesafe/); assert.equal(jobResult.costUsdAllAttempts, null);
});

test("late classifier completion after abort preserves known subtotal but cannot authorize further requests", async () => {
  const controller = new AbortController(); const inner = direct();
  const bounded = boundClassifierEstimatedClient({ classify: async request => {
    const result = await inner.classify({ ...request, signal: undefined }); controller.abort(new Error("SENTINEL")); return result;
  } }, limits);
  await assert.rejects(bounded.client.classify({ ...req, signal: controller.signal }), e => !String(e).includes("SENTINEL"));
  assert.ok(bounded.snapshot().knownEstimatedUsd > 0); assert.equal(bounded.snapshot().estimatedUsd, null);
  await assert.rejects(bounded.client.classify(req)); assert.equal(bounded.snapshot().calls, 1);
});
