import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { NativeLLMCompletion } from "@aiw/telemetry";
import { boundSubscriptionClient } from "../src/subscription.ts";
import { boundEstimatedClient } from "../src/estimated.ts";
import { readAttemptCost } from "../src/accounting.ts";
import { buildPlan } from "../src/plan.ts";
import { combineRuns } from "../src/combine.ts";
import { resolveConfig } from "../src/config.ts";
import { runScheduler } from "../src/scheduler.ts";
import { runLoop } from "../src/loop.ts";
import { createReporter } from "@aiw/telemetry";
import { createRunDir, writeJobJSON, writeRunJSON } from "../src/rundir.ts";
const native: NativeLLMCompletion = { response: {}, usage: null, usageStatus: "unavailable", usageReason: "native-harness-unreported",
  completionEvidence: { completionId: "fixture", requestSHA256: "a".repeat(64), responseSHA256: "b".repeat(64) } };
const limits = { maxCalls: 3, maxTokens: 100, maxDurationMs: 10000 };
const request = { model: "fixture", system: "", tools: [], messages: [] };
for (const estimated of [false, true]) test(`numeric budget rejects native and closes future dispatch (estimated=${estimated})`, async () => {
  let calls = 0;
  const client = { complete: async () => { calls++; return native; } };
  const bounded = estimated ? boundEstimatedClient(client, { ...limits, estimateLimitUsd: 1 }) : boundSubscriptionClient(client, limits);
  await assert.rejects(bounded.client.complete(request), /Unsupported native format/);
  assert.equal(bounded.snapshot().incomplete, true);
  await assert.rejects(bounded.client.complete(request));
  assert.equal(calls, 1);
});
/** Retain all synthesized fixture records for review, including failed attempts. */
function temp(): string {
  const evidenceRoot = process.env.NATIVE_TEST_EVIDENCE ?? join(tmpdir(), "aiw-native-test-evidence");
  mkdirSync(evidenceRoot, { recursive: true });
  return mkdtempSync(join(evidenceRoot, "native-rejection-"));
}
for (const record of [native, { format: "native-orchestrate-event-v1" }, { format: "native-orchestrate-evidence-v1" }]) test(`numeric accounting rejects ${JSON.stringify(record)}`, t => {
  const path = join(temp(), "events.jsonl");
  writeFileSync(path, JSON.stringify(record) + "\n");
  assert.throws(() => readAttemptCost(path), /Unsupported native format/);
});
test("plan, configuration, scheduler and writers reject native before allocation or aggregate", async t => {
  const root = temp();
  const config = { provider: "native", usageMode: "native", reps: 1, problems: [], frameworks: [] } as any;
  assert.throws(() => buildPlan(config, root), /Unsupported native format/);
  assert.throws(() => resolveConfig(config, []), /Unsupported native format/);
  await assert.rejects(runScheduler({ config } as any, {} as any), /Unsupported native format/);
  assert.throws(() => createRunDir(root, "bad", config, {} as any), /Unsupported native format/);
  for (const write of [writeJobJSON, writeRunJSON]) assert.throws(() => write(root, { format: "native-orchestrate-evidence-v1" } as any), /Unsupported native format/);
});
test("plan refuses native historical job and report refuses native run", async t => {
  const root = temp(), run = join(root, "experiments", "runs", "fixture"), job = join(run, "job");
  mkdirSync(job, { recursive: true });
  writeFileSync(join(job, "job.json"), JSON.stringify({ format: "native-orchestrate-evidence-v1" }));
  const config = { reps: 1, problems: ["p"], frameworks: ["baseline"] } as any;
  assert.throws(() => buildPlan(config, root), /Unsupported native format/);
  writeFileSync(join(run, "run.json"), JSON.stringify({ format: "native-orchestrate-evidence-v1" }));
  await assert.rejects(combineRuns([run], "fixture-report", root), /Unsupported native format/);
});
test("numeric main loop rejects native before writing turns or metrics", async () => {
  let events = 0;
  const reporter = createReporter({ writer: "r", sink: { write: () => { events++; } } });
  await assert.rejects(runLoop({ client: { complete: async () => native }, reporter, session: { tools: [] },
    systemPrompt: "", taskText: "fixture", model: "fixture", temperature: 0, turnLimit: 1, framework: "baseline" } as any), /Unsupported native format/);
  assert.equal(events, 0);
});

test("report refuses a native job inside an otherwise numeric run", async t => {
  const root = temp(), job = join(root, "job");
  mkdirSync(job);
  writeFileSync(join(root, "run.json"), JSON.stringify({ format: 1, id: "fixture", status: "complete", config: { tier: "S", models: {}, temperature: 0, secondaryCap: 4, branch: {} }, provenance: { dirty: false, commit: "fixture", runnerVersion: "fixture", engine: "fixture", basePrompt: "fixture", frameworks: {}, images: {}, problems: {} } }));
  writeFileSync(join(job, "job.json"), JSON.stringify({ format: "native-orchestrate-evidence-v1" }));
  await assert.rejects(combineRuns([root], "fixture", root), /Unsupported native format/);
});

test("numeric accounting and report reject actual sink artifacts", async () => {
  const { nativeArtifactFixture } = await import("../../telemetry/test/native-artifact-fixture.ts");
  const artifacts = nativeArtifactFixture();
  for (const raw of [artifacts.event, artifacts.summary]) {
    const root = temp(), path = join(root, "events.jsonl");
    writeFileSync(path, raw);
    assert.throws(() => readAttemptCost(path), /Unsupported native format/);
    writeFileSync(join(root, "run.json"), raw);
    await assert.rejects(combineRuns([root], "fixture", root), /Unsupported native format/);
  }
});
