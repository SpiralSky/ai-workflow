import { mockProvenance } from "./provenance-fixture.ts";
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readAttemptCost, AttemptFailure } from "../src/accounting.ts";
import { runScheduler } from "../src/scheduler.ts";
import { createAttemptDir } from "../src/rundir.ts";
import type { RunJSON, JobResult } from "../src/types.ts";

/** Creates an isolated fixture with automatic cleanup. */
function temp(t: { after: (fn: () => void) => void }): string {
  const root = mkdtempSync(join(tmpdir(), "aiw-cost-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
/** Serializes real telemetry schema fixtures, never model requests. */
function turn(id: string, role: string, costUsd?: number): object {
  return { v: 1, id, parent: null, ts: 1, kind: "turn", model: "fixture", role,
    usage: { input: 1, output: 1 }, latencyMs: 1, ...(costUsd === undefined ? {} : { costUsd }) };
}

test("attempt cost counts all roles once, ignores non-cost attachment values", (t) => {
  const path = join(temp(t), "events.jsonl");
  const events = [turn("r:1", "main", 1), turn("s:1", "selection", 2), turn("s:2", "secondary", 3),
    { v: 1, id: "s:3", parent: null, ts: 1, kind: "attach", key: "cost", data: { costUsd: 100 } }];
  writeFileSync(path, events.map((e) => JSON.stringify(e)).join("\n"));
  assert.deepEqual(readAttemptCost(path), { costUsd: 6, knownCostUsd: 6, costIncompleteReasons: [] });
});

for (const bad of [turn("s:2", "secondary"), turn("s:2", "bad-role", 2), turn("s:2", "secondary", -1)]) {
  test(`incomplete cost remains null: ${JSON.stringify(bad)}`, (t) => {
    const path = join(temp(t), "events.jsonl");
    writeFileSync(path, [turn("r:1", "main", 1), bad].map((e) => JSON.stringify(e)).join("\n"));
    const cost = readAttemptCost(path);
    assert.equal(cost.costUsd, null);
    assert.equal(cost.knownCostUsd, 1);
    assert.ok(cost.costIncompleteReasons.length);
  });
}

test("duplicate/conflicting turn IDs and truncated records invalidate accounting", (t) => {
  const path = join(temp(t), "events.jsonl");
  writeFileSync(path, [turn("r:1", "main", 1), turn("r:1", "main", 9)].map((e) => JSON.stringify(e)).join("\n") + '\n{"v":');
  const cost = readAttemptCost(path);
  assert.equal(cost.costUsd, null);
  assert.equal(cost.knownCostUsd, 1);
  assert.deepEqual(cost.costIncompleteReasons, ["duplicate-turn-id", "malformed-event"]);
});

test("zero logged turns do not imply zero charge after an unobserved failed request", (t) => {
  const path = join(temp(t), "events.jsonl");
  writeFileSync(path, "");
  assert.equal(readAttemptCost(path).costUsd, 0);
  assert.equal(readAttemptCost(path, ["unobserved-failed-model-request"]).costUsd, null);
});

/** Minimal scheduler configuration, with complete synthetic provenance. */
function runFixture(): RunJSON {
  return { format: 1, id: "fixture", status: "in-progress", startedAt: "now",
    config: { kind: "dev", problems: ["p"], frameworks: ["orchestrate"], tier: "S", reps: 1, budgetUsd: 100,
      concurrency: 1, models: { main: "fixture", secondary: "fixture" }, temperature: 0, secondaryCap: 4,
      branch: { context: "trace", timeoutMs: 1, limits: { valueChars: 1, loopCollapse: 1, eventBudget: 1 } } },
    provenance: { commit: "fixture", dirty: false, runnerVersion: "fixture", engine: "fixture", basePrompt: "fixture", frameworks: {}, images: {}, problems: {} },
    totals: { jobs: 0, attempts: 0, costUsd: 0, pass: 0, fail: 0 } };
}
/** Creates a complete cost-bearing simulated attempt result. */
function result(costUsd: number | null, knownCostUsd = costUsd ?? 0): JobResult {
  return { outcome: "pass", reason: null, costUsd, knownCostUsd, durationMs: 1, eventsPath: "fixture" };
}

test("first known-cost infra failure stops without retry and preserves raw attempt evidence", async (t) => {
  const root = temp(t), run = runFixture();
  let calls = 0;
  const reason = await runScheduler({ jobs: [0, 1].map((rep) => ({ problem: "p", framework: "orchestrate", rep })), config: run.config,
    runPath: root, repoRoot: root, apiKey: "fixture", baseURL: "https://example.invalid", turnLimits: {}, problemsDir: root,
    runAttempt: async (opts) => {
      const path = join(opts.job.dir!, "events.jsonl");
      writeFileSync(path, JSON.stringify(turn("r:1", "main", ++calls)) + "\n");
      throw new AttemptFailure("grading infra failure", readAttemptCost(path), path, 1);
    } }, run);
  assert.match(reason!, /job-failed/);
  assert.equal(calls, 1);
  assert.equal(run.totals.costUsd, 1);
  assert.equal(run.totals.attempts, 1);
  const dir = join(root, "p.orchestrate.0");
  assert.match(readFileSync(join(dir, "events.jsonl"), "utf8"), /"costUsd":1/);
  const job = JSON.parse(readFileSync(join(dir, "job.json"), "utf8"));
  assert.equal(job.costUsdAllAttempts, 1);
  assert.deepEqual(job.attempts.map((a: any) => a.costUsd), [1]);
  assert.equal(job.attempts[0].infraError, "grading infra failure");
});

test("unknown failed charge stops dispatch/retry, preserves known lower bound", async (t) => {
  const root = temp(t), run = runFixture();
  let calls = 0;
  const reason = await runScheduler({ jobs: [0, 1].map((rep) => ({ problem: "p", framework: "orchestrate", rep })), config: run.config,
    runPath: root, repoRoot: root, apiKey: "fixture", baseURL: "https://example.invalid", turnLimits: {}, problemsDir: root,
    runAttempt: async () => {
      calls++;
      throw new AttemptFailure("request dropped", { costUsd: null, knownCostUsd: 2, costIncompleteReasons: ["unobserved-failed-model-request"] }, "fixture", 1);
    } }, run);
  assert.equal(reason, "cost-incomplete");
  assert.equal(calls, 1);
  assert.equal(run.totals.costUsd, null);
  assert.equal(run.totals.knownCostUsd, 2);
  assert.equal(run.totals.fail, 1);
});

test("known-cost failure finalizes accounting without the former three-attempt retry storm", async (t) => {
  const root = temp(t), run = runFixture();
  const reason = await runScheduler({ jobs: [{ problem: "p", framework: "orchestrate", rep: 0 }], config: run.config,
    runPath: root, repoRoot: root, apiKey: "fixture", baseURL: "https://example.invalid", turnLimits: {}, problemsDir: root,
    runAttempt: async () => { throw new AttemptFailure("known failure", { costUsd: 1, knownCostUsd: 1, costIncompleteReasons: [] }, "fixture", 1); } }, run);
  assert.match(reason!, /job-failed/);
  assert.deepEqual(run.totals, { jobs: 1, attempts: 1, costUsd: 1, knownCostUsd: 1, pass: 0, fail: 1 });
});

test("budget reached by failed attempt prevents another paid retry", async (t) => {
  const root = temp(t), run = runFixture(); run.config.budgetUsd = 1;
  let calls = 0;
  const reason = await runScheduler({ jobs: [{ problem: "p", framework: "orchestrate", rep: 0 }], config: run.config,
    runPath: root, repoRoot: root, apiKey: "fixture", baseURL: "https://example.invalid", turnLimits: {}, problemsDir: root,
    runAttempt: async () => { calls++; throw new AttemptFailure("known failure", { costUsd: 1, knownCostUsd: 1, costIncompleteReasons: [] }, "fixture", 1); } }, run);
  assert.equal(reason, "budget"); assert.equal(calls, 1); assert.equal(run.totals.costUsd, 1);
});

test("attempt archive refuses collisions rather than overwriting evidence", (t) => {
  const root = temp(t); mkdirSync(join(root, "attempts/0"), { recursive: true });
  writeFileSync(join(root, "events.jsonl"), "keep");
  assert.throws(() => createAttemptDir(root, 1), /already exists/);
  assert.equal(readFileSync(join(root, "events.jsonl"), "utf8"), "keep");
});

test("concurrent jobs contribute exactly once even if one finishes after budget stop", async (t) => {
  const root = temp(t), run = runFixture(); run.config.concurrency = 2; run.config.budgetUsd = 2;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const reason = await runScheduler({ jobs: [0, 1, 2].map((rep) => ({ problem: "p", framework: "orchestrate", rep })), config: run.config,
    runPath: root, repoRoot: root, apiKey: "fixture", baseURL: "https://example.invalid", turnLimits: {}, problemsDir: root,
    runAttempt: async (opts) => {
      if (opts.job.rep === 0) { await gate; return result(3); }
      release(); return result(2);
    } }, run);
  assert.equal(reason, "budget");
  assert.equal(run.totals.attempts, 2);
  assert.equal(run.totals.costUsd, 5);
  assert.equal(run.totals.jobs, 2);
});

test("MCP error metadata and nested error uncertainty survive the main loop", async (t) => {
  const { runLoop } = await import("../src/loop.ts");
  const { createReporter, FileSink } = await import("@aiw/telemetry");
  const path = join(temp(t), "events.jsonl"), sink = new FileSink(path);
  const reporter = createReporter({ sink, writer: "r" });
  let calls = 0;
  const loop = await runLoop({ client: { complete: async () => ({ response: { choices: [{ message: ++calls === 1 ? {
    tool_calls: [{ id: "call-1", function: { name: "do", arguments: '{}' } }],
  } : { content: "done" } }] }, usage: { input: 1, output: 1 }, costUsd: 1 }) }, reporter,
    session: { tools: [], _client: { callTool: async (req: any) => {
      assert.equal(req._meta["aiw/harnessId"], "call-1");
      assert.deepEqual(req.arguments, {});
      sink.write(turn("s:1", "selection", 2));
      return { content: [{ type: "text", text: "executor failed before usage response" }], isError: true };
    } } as any }, systemPrompt: "fixture", taskText: "fixture", model: "fixture", temperature: 0, turnLimit: 2, framework: "orchestrate" });
  sink.close();
  const cost = readAttemptCost(path, loop.metrics.costIncompleteReasons);
  assert.equal(cost.costUsd, null);
  assert.equal(cost.knownCostUsd, 3);
  assert.equal(calls, 1);
  assert.equal(loop.outcome, "infra-error");
  assert.ok(cost.costIncompleteReasons.includes("failed-tool-may-have-unobserved-charges"));
});

test("unexpected failure salvages logged lower bound without claiming complete cost", async (t) => {
  const root = temp(t), run = runFixture();
  const reason = await runScheduler({ jobs: [{ problem: "p", framework: "orchestrate", rep: 0 }], config: run.config,
    runPath: root, repoRoot: root, apiKey: "fixture", baseURL: "https://example.invalid", turnLimits: {}, problemsDir: root,
    runAttempt: async (opts) => {
      writeFileSync(join(opts.job.dir!, "events.jsonl"), JSON.stringify(turn("r:1", "main", 3)) + "\n");
      throw new Error("unexpected cleanup failure");
    } }, run);
  assert.equal(reason, "cost-incomplete");
  assert.equal(run.totals.costUsd, null);
  assert.equal(run.totals.knownCostUsd, 3);
});

test("history projection refuses unknown costs instead of projecting zero", async (t) => {
  const { buildPlan } = await import("../src/plan.ts");
  const root = temp(t), run = runFixture();
  const dir = join(root, "experiments/runs/history/p.orchestrate.0"); mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "job.json"), JSON.stringify({ problem: "p", framework: "orchestrate", costUsdAllAttempts: null }));
  const plan = buildPlan(run.config, root);
  assert.equal(plan.projectedCostUsd, undefined);
});

test("first graded failure stops dispatch and never marks an incomplete matrix complete", async (t) => {
  const root = temp(t), run = runFixture();
  run.config.reps = 3;
  const seen: number[] = [];
  const reason = await runScheduler({ jobs: [0, 1, 2].map((rep) => ({ problem: "p", framework: "orchestrate", rep })), config: run.config,
    runPath: root, repoRoot: root, apiKey: "fixture", baseURL: "https://example.invalid", turnLimits: {}, problemsDir: root,
    runAttempt: async ({ job }) => { seen.push(job.rep); return { ...result(2), outcome: "fail", reason: "checks" }; } }, run);
  assert.equal(reason, "job-failed:p.orchestrate.0");
  assert.deepEqual(seen, [0]);
  assert.deepEqual(run.status, { invalid: reason });
  assert.deepEqual(run.totals, { jobs: 1, attempts: 1, costUsd: 2, knownCostUsd: 2, pass: 0, fail: 1 });
  assert.equal(run.config.reps, 3); // Do not shrink the denominator to observed cells.
  assert.deepEqual(JSON.parse(readFileSync(join(root, "run.json"), "utf8")).status, { invalid: reason });
});

test("failure cancels concurrent work but waits for its unknown charges and retains the first cause", async (t) => {
  const root = temp(t), run = runFixture(); run.config.concurrency = 2;
  let entered!: () => void;
  const otherStarted = new Promise<void>((resolve) => { entered = resolve; });
  const seen: number[] = [];
  const reason = await runScheduler({ jobs: [0, 1, 2].map((rep) => ({ problem: "p", framework: "orchestrate", rep })), config: run.config,
    runPath: root, repoRoot: root, apiKey: "fixture", baseURL: "https://example.invalid", turnLimits: {}, problemsDir: root,
    runAttempt: async ({ job, signal }) => {
      seen.push(job.rep);
      if (job.rep === 0) { await otherStarted; return { ...result(2), outcome: "fail", reason: "checks" }; }
      await new Promise<void>((resolve) => { signal!.addEventListener("abort", () => resolve(), { once: true }); entered(); });
      assert.ok(signal!.aborted);
      throw new AttemptFailure("cancelled while provider pending", { costUsd: null, knownCostUsd: 3,
        costIncompleteReasons: ["cancelled-container-lifecycle"] }, "fixture", 1);
    } }, run);
  assert.deepEqual(seen, [0, 1]);
  assert.equal(reason, "job-failed:p.orchestrate.0");
  assert.deepEqual(run.totals, { jobs: 2, attempts: 2, costUsd: null, knownCostUsd: 5, pass: 0, fail: 2 });
  const cancelled = JSON.parse(readFileSync(join(root, "p.orchestrate.1", "job.json"), "utf8"));
  assert.equal(cancelled.costUsdAllAttempts, null);
  assert.equal(cancelled.knownCostUsdAllAttempts, 3);
  assert.match(cancelled.attempts[0].infraError, /cancelled/);
});

test("all passing cells still execute and retain full success criterion", async (t) => {
  const root = temp(t), run = runFixture();
  run.provenance = mockProvenance(run.config);
  const reason = await runScheduler({ jobs: [0, 1, 2].map((rep) => ({ problem: "p", framework: "orchestrate", rep })), config: run.config,
    runPath: root, repoRoot: root, apiKey: "fixture", baseURL: "https://example.invalid", turnLimits: {}, problemsDir: root,
    runAttempt: async () => result(1) }, run);
  assert.equal(reason, undefined);
  assert.deepEqual(run.totals, { jobs: 3, attempts: 3, costUsd: 3, knownCostUsd: 3, pass: 3, fail: 0 });
});

test("scheduler observer error cancels siblings and drains their cost before reporting error", async (t) => {
  const root = temp(t), run = runFixture(); run.config.concurrency = 2;
  let started!: () => void;
  const gate = new Promise<void>((resolve) => { started = resolve; });
  await assert.rejects(runScheduler({ jobs: [0, 1, 2].map((rep) => ({ problem: "p", framework: "orchestrate", rep })), config: run.config,
    runPath: root, repoRoot: root, apiKey: "fixture", baseURL: "https://example.invalid", turnLimits: {}, problemsDir: root,
    onJobDone: (job) => { if (job.rep === 0) throw new Error("observer failed"); },
    runAttempt: async ({ job, signal }) => {
      if (job.rep === 0) { await gate; return result(1); }
      await new Promise<void>((resolve) => { signal!.addEventListener("abort", () => resolve(), { once: true }); started(); });
      return result(2); // This simulated request settled with complete usage despite abort.
    } }, run), /scheduler error/);
  assert.equal(run.totals.costUsd, 3);
  assert.equal(run.totals.attempts, 2);
  assert.deepEqual(run.status, { invalid: "scheduler-error:p.orchestrate.0" });
});

test("failure notification cancels siblings before failing attempt cleanup settles", async (t) => {
  const root = temp(t), run = runFixture(); run.config.concurrency = 2;
  let started!: () => void, cancelled!: () => void;
  const entered = new Promise<void>((resolve) => { started = resolve; });
  const observedAbort = new Promise<void>((resolve) => { cancelled = resolve; });
  const reason = await runScheduler({ jobs: [0, 1, 2].map((rep) => ({ problem: "p", framework: "orchestrate", rep })), config: run.config,
    runPath: root, repoRoot: root, apiKey: "fixture", baseURL: "https://example.invalid", turnLimits: {}, problemsDir: root,
    runAttempt: async ({ job, signal, onFailure }) => {
      if (job.rep === 0) {
        await entered;
        onFailure!();
        await observedAbort; // Failure cleanup cannot settle until sibling has observed abort.
        return { ...result(1), outcome: "fail", reason: "checks" };
      }
      await new Promise<void>((resolve) => {
        signal!.addEventListener("abort", () => { cancelled(); resolve(); }, { once: true });
        started();
      });
      return result(2);
    } }, run);
  assert.equal(reason, "job-failed:p.orchestrate.0");
  assert.equal(run.totals.attempts, 2);
  assert.equal(run.totals.costUsd, 3);
});
