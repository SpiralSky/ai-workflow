import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTypeSafeDecisionsClient, createDeepSeekClient, TYPESAFE_MODEL, type DecisionsClient } from "@aiw/llm";
import { createCostMeter } from "../src/cost-meter.ts";
import { resolveConfig, type EvalFlags } from "../src/config.ts";
import { frameworkLaunch } from "../src/framework-launch.ts";
import { runScheduler } from "../src/scheduler.ts";
import { mockProvenance } from "./provenance-fixture.ts";
import type { RunJSON } from "../src/types.ts";
const req = { instruction: "read file", candidates: [{ id: "c0", name: "read", whenToUse: "read file" }] };
const flags: EvalFlags = { problems: "p", mode: "orchestrate[rerank=classifier]", tools: "S", reps: 1, model: "deepseek-flash", temperature: 0, budget: 1, full: false, branchContext: "trace", secondaryCap: 4,
  provider: "deepseek", classifierProvider: "typesafe", classifierModel: TYPESAFE_MODEL, classifierThreshold: 0.8 };
const result = () => ({ model: TYPESAFE_MODEL, answers: { c0: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 100, output_tokens: 10 } });
const direct = (body: object = result()) => createTypeSafeDecisionsClient({ apiKey: "SYNTHETIC", model: TYPESAFE_MODEL, fetch: (async () => Response.json(body)) as typeof fetch });
const classifierCost = 100 * 0.042 / 1e6;
const mainCost = (10 * 0.15 + 2 * 0.6) / 1e6;
const deepseek = () => createDeepSeekClient({ apiKey: "synthetic", now: () => Date.parse("2026-11-01T12:00:00Z"), fetch: (async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: "done", reasoning_content: "opaque" } }], usage: { prompt_tokens: 10, completion_tokens: 2, prompt_cache_hit_tokens: 0, prompt_cache_miss_tokens: 10 } })) as typeof fetch });
const mainReq = { model: "deepseek-flash", system: "fixture", messages: [], tools: [] };

test("explicit direct classifier contract and no OpenRouter dependency", () => {
  const config = resolveConfig(flags, []); assert.equal(config.classifier!.provider, "typesafe");
  assert.equal(frameworkLaunch(config.frameworks[0]!, config).network, "none");
  for (const change of [{ classifierModel: "jev-latest" }, { provider: "chatgpt", subscriptionLimits: { maxCalls: 1, maxTokens: 1, maxDurationMs: 1 } }, { classifierProvider: "openrouter-decisions" }]) assert.throws(() => resolveConfig({ ...flags, ...change } as EvalFlags, []));
});

test("malformed billed answer keeps its cost; unknown subsequent usage poisons admission retaining the subtotal", async () => {
  let calls = 0;
  const meter = createCostMeter(1);
  const client = meter.classifier(createTypeSafeDecisionsClient({ apiKey: "x", model: TYPESAFE_MODEL, fetch: (async () => Response.json(++calls === 1 ? { ...result(), answers: {} } : { ...result(), usage: {} })) as typeof fetch }));
  assert.equal((await client.classify(req)).answers, null);
  assert.equal(meter.snapshot().knownCostUsd, classifierCost);
  await client.classify(req); await assert.rejects(client.classify(req), /cost-incomplete/);
  assert.equal(calls, 2); assert.equal(meter.snapshot().incomplete, true); assert.equal(meter.snapshot().knownCostUsd, classifierCost);
});

test("late classifier completion after abort keeps its cost but cannot authorize further requests", async () => {
  const controller = new AbortController(); const inner = direct();
  const meter = createCostMeter(1);
  const client = meter.classifier({ classify: async request => {
    const r = await inner.classify({ ...request, signal: undefined }); controller.abort(new Error("SENTINEL")); return r;
  } });
  await assert.rejects(client.classify({ ...req, signal: controller.signal }), e => !String(e).includes("SENTINEL"));
  assert.equal(meter.snapshot().knownCostUsd, classifierCost); assert.equal(meter.snapshot().incomplete, true);
  await assert.rejects(client.classify(req)); assert.equal(meter.snapshot().calls, 1);
});

test("one budget covers main and classifier: classifier spend closes main admission and vice versa", async () => {
  const meter = createCostMeter(mainCost + classifierCost / 2);
  const main = meter.llm(deepseek()), classifier = meter.classifier(direct());
  await main.complete(mainReq);
  await classifier.classify(req); // Admitted below budget; pushes the shared total over it.
  await assert.rejects(main.complete(mainReq), /budget/);
  await assert.rejects(classifier.classify(req), /budget/);
  assert.equal(meter.snapshot().calls, 2); assert.equal(meter.snapshot().knownCostUsd, mainCost + classifierCost);
});

test("scheduler stops a DeepSeek + TypeSafe run once the shared budget is reached", async t => {
  const root = mkdtempSync(join(tmpdir(), "aiw-typesafe-scheduler-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  // Budget fits one main call plus part of a classifier call, so the first job's classifier spend exhausts it.
  const config = resolveConfig({ ...flags, mode: "baseline,orchestrate[rerank=classifier]", reps: 2, budget: mainCost + classifierCost / 2 }, []);
  const run: RunJSON = { format: 1, id: "fixture", status: "in-progress", config, provenance: mockProvenance(config), totals: { jobs: 0, attempts: 0, costUsd: 0, pass: 0, fail: 0 }, startedAt: "fixture" };
  const jobs = [...config.frameworks].reverse().flatMap(framework => [0, 1].map(rep => ({ problem: "p", framework, rep })));
  const attempted: string[] = [];
  const invalid = await runScheduler({ config, llmClient: deepseek(), classifierClient: direct() as DecisionsClient, jobs, runPath: root, repoRoot: root, apiKey: "", baseURL: "", problemsDir: root, turnLimits: {},
    runAttempt: async ({ job, llmClient, classifierClient }) => {
      attempted.push(job.framework);
      let cost = (await llmClient!.complete(mainReq)).costUsd!;
      if (job.framework.includes("classifier")) cost += (await classifierClient!.classify(req)).costUsd!;
      return { outcome: "pass", reason: null, durationMs: 1, eventsPath: "fixture", costUsd: cost, knownCostUsd: cost };
    } }, run);
  assert.equal(invalid, "budget");
  assert.deepEqual(attempted, ["orchestrate[rerank=classifier]"], "no main call is dispatched after classifier spend reaches the budget");
  assert.ok(Math.abs(run.totals.costUsd! - (mainCost + classifierCost)) < 1e-15);
});
