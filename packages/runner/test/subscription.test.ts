import { mockProvenance } from "./provenance-fixture.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { LLMClient } from "@aiw/telemetry";
import { boundSubscriptionClient } from "../src/subscription.ts";
import { resolveConfig, type EvalFlags } from "../src/config.ts";
import { frameworkLaunch } from "../src/framework-launch.ts";
import { runScheduler } from "../src/scheduler.ts";
import type { RunJSON } from "../src/types.ts";

const req = { model: "fixture", system: "system", messages: [], tools: [] };
const limits = { maxCalls: 4, maxTokens: 100, maxDurationMs: 30_000 };
const flags: EvalFlags = { problems: "smoke", mode: "compare", tools: "S", reps: 1, model: "fixture", temperature: 0, budget: 0.5,
  full: false, branchContext: "trace", secondaryCap: 4, provider: "chatgpt", usageMode: "subscription", subscriptionLimits: limits };
const registry = [{ id: "p", size: "smoke", set: "dev" }];
const result = { response: {}, usage: { input: 3, output: 2, cachedRead: 1 } };

test("subscription admission reserves calls before dispatch and serializes all roles", async () => {
  let active = 0, peak = 0, calls = 0;
  const bounded = boundSubscriptionClient({ async complete() {
    active++; peak = Math.max(active, peak); calls++;
    await new Promise(resolve => setTimeout(resolve, 5)); active--;
    return { ...result, costUsd: 0 };
  } }, { ...limits, maxCalls: 2 });
  const responses = await Promise.allSettled([1, 2, 3].map(() => bounded.client.complete(req)));
  assert.equal(calls, 2); assert.equal(peak, 1);
  assert.equal(responses[2]!.status, "rejected");
  assert.equal((responses[0] as PromiseFulfilledResult<any>).value.costUsd, undefined);
  assert.equal(bounded.snapshot().calls, 2); assert.equal(bounded.snapshot().cachedReadTokens, 2);
  assert.equal(bounded.snapshot().cacheWriteTokens, undefined);
});

test("token threshold stops next call and records final-response overshoot honestly", async () => {
  const bounded = boundSubscriptionClient({ complete: async () => result }, { ...limits, maxTokens: 4 });
  await bounded.client.complete(req);
  assert.equal(bounded.snapshot().inputTokens + bounded.snapshot().outputTokens, 5);
  await assert.rejects(bounded.client.complete(req), /token-limit/);
});

test("unknown or failed usage blocks subsequent calls; no retry or paid fallback", async () => {
  let calls = 0;
  const bounded = boundSubscriptionClient({ complete: async () => { calls++; throw new Error("mock failure"); } }, limits);
  await assert.rejects(bounded.client.complete(req));
  await assert.rejects(bounded.client.complete(req), /request-failed/);
  assert.equal(calls, 1); assert.equal(bounded.snapshot().incomplete, true);
  const malformed = boundSubscriptionClient({ complete: async () => ({ response: {}, usage: { input: NaN, output: 1 } }) }, limits);
  await assert.rejects(malformed.client.complete(req), /usage unavailable/);
  assert.equal(malformed.snapshot().incomplete, true);
});

test("deadline cancels in-flight work; caller cancellation before admission costs no calls", async () => {
  const cancelled = new AbortController(); cancelled.abort();
  const bounded = boundSubscriptionClient({ complete: async () => result }, limits);
  await assert.rejects(bounded.client.complete({ ...req, signal: cancelled.signal }));
  assert.equal(bounded.snapshot().calls, 0);
  const slow: LLMClient = { complete: async request => new Promise((_, reject) => {
    (request.signal as AbortSignal).addEventListener("abort", () => reject(new Error("deadline")), { once: true });
  }) };
  const timed = boundSubscriptionClient(slow, { ...limits, maxDurationMs: 10 });
  // A referenced test timer keeps the event loop alive while AbortSignal.timeout is unref'ed.
  const keepAlive = setTimeout(() => {}, 1000);
  try { await assert.rejects(timed.client.complete(req), /deadline/); } finally { clearTimeout(keepAlive); }
  assert.equal(timed.snapshot().incomplete, true);
});

test("subscription configuration is explicit, serial, bounded, and rejects mixed monetary mode", () => {
  assert.equal(resolveConfig(flags, registry).provider, "chatgpt");
  for (const changed of [ { usageMode: "monetary" }, { provider: "openrouter" }, { subscriptionLimits: undefined }, { concurrency: 2 },
    { subscriptionLimits: { ...limits, maxCalls: 0 } }, { model: "deepseek/deepseek-v4-flash" } ]) {
    assert.throws(() => resolveConfig({ ...flags, ...changed } as EvalFlags, registry));
  }
  const launch = frameworkLaunch("orchestrate", resolveConfig(flags, registry), { apiKey: "never-serialize-me", baseURL: "https://attacker.invalid" });
  assert.ok(launch.executorArgs.includes("host"));
  assert.ok(!JSON.stringify(launch).includes("never-serialize-me"));
  assert.ok(!JSON.stringify(launch).includes("attacker"));
});

test("scheduler completes full mock matrix with unknown dollars only in explicit bounded subscription mode", async t => {
  const root = mkdtempSync(join(tmpdir(), "aiw-subscription-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = resolveConfig(flags, registry);
  const subscription = boundSubscriptionClient({ complete: async () => result }, limits);
  const run: RunJSON = { format: 1, id: "fixture", status: "in-progress", config,
    provenance: mockProvenance(config),
    totals: { jobs: 0, attempts: 0, costUsd: 0, pass: 0, fail: 0 }, startedAt: "fixture" };
  const invalid = await runScheduler({ config, subscription, jobs: config.frameworks.map(framework => ({ problem: "p", framework, rep: 0 })),
    runPath: root, repoRoot: root, apiKey: "", baseURL: "", problemsDir: root, turnLimits: {},
    runAttempt: async () => { await subscription.client.complete(req); return { outcome: "pass", reason: null, durationMs: 1,
      eventsPath: "fixture", costUsd: null, knownCostUsd: 0, costIncompleteReasons: ["missing-or-invalid-turn-cost"] }; },
  }, run);
  assert.equal(invalid, undefined); assert.equal(run.totals.jobs, 3); assert.equal(run.totals.pass, 3);
  assert.equal(run.totals.costUsd, null); assert.equal(run.subscriptionUsage!.calls, 3);
});

test("runtime validation rejects missing bounds, timer overflow and malformed cache counters", async () => {
  for (const malformed of [{}, { ...limits, maxDurationMs: 2 ** 32 }, { ...limits, maxTokens: NaN }]) {
    assert.throws(() => boundSubscriptionClient({ complete: async () => result }, malformed as typeof limits));
  }
  const bounded = boundSubscriptionClient({ complete: async () => ({ ...result, usage: { input: 1, output: 1, cachedRead: 2 } }) }, limits);
  await assert.rejects(bounded.client.complete(req), /cache usage unavailable/);
});

for (const scenario of ["quota", "telemetry", "failure"] as const) {
  test(`subscription scheduler stops on ${scenario} without dispatching remaining matrix`, async t => {
    const root = mkdtempSync(join(tmpdir(), "aiw-subscription-stop-")); t.after(() => rmSync(root, { recursive: true, force: true }));
    const config = resolveConfig({ ...flags, subscriptionLimits: { ...limits, maxCalls: 1 } }, registry);
    const subscription = boundSubscriptionClient({ complete: async () => result }, config.subscriptionLimits!);
    const run: RunJSON = { format: 1, id: "fixture", status: "in-progress", config,
      provenance: mockProvenance(config),
      totals: { jobs: 0, attempts: 0, costUsd: null, pass: 0, fail: 0 }, startedAt: "fixture" };
    let attempts = 0;
    const invalid = await runScheduler({ config, subscription, jobs: config.frameworks.map(framework => ({ problem: "p", framework, rep: 0 })),
      runPath: root, repoRoot: root, apiKey: "", baseURL: "", problemsDir: root, turnLimits: {},
      runAttempt: async () => { attempts++; await subscription.client.complete(req); return { outcome: scenario === "failure" ? "fail" : "pass", reason: null, durationMs: 1,
        eventsPath: "fixture", costUsd: null, knownCostUsd: 0, costIncompleteReasons: [scenario === "telemetry" ? "malformed-event" : "missing-or-invalid-turn-cost"] }; },
    }, run);
    assert.equal(attempts, 1); assert.equal(run.totals.jobs, 1); assert.equal(run.totals.costUsd, null);
    assert.match(invalid!, scenario === "quota" ? /subscription-call-limit/ : scenario === "telemetry" ? /subscription-usage-incomplete/ : /job-failed/);
  });
}
