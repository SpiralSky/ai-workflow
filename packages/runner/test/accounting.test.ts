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

test("scheduler includes failed-attempt charges and preserves raw retry logs", async (t) => {
  const root = temp(t), run = runFixture();
  let calls = 0;
  const reason = await runScheduler({ jobs: [{ problem: "p", framework: "orchestrate", rep: 0 }], config: run.config,
    runPath: root, repoRoot: root, apiKey: "fixture", baseURL: "https://example.invalid", turnLimits: {}, problemsDir: root,
    wait: async () => {}, runAttempt: async (opts) => {
      const path = join(opts.job.dir!, "events.jsonl");
      writeFileSync(path, JSON.stringify(turn("r:1", "main", ++calls)) + "\n");
      if (calls === 1) throw new AttemptFailure("grading infra failure", readAttemptCost(path), path, 1);
      return { ...result(2), eventsPath: path };
    } }, run);
  assert.equal(reason, undefined);
  assert.equal(run.totals.costUsd, 3);
  assert.equal(run.totals.attempts, 2);
  const dir = join(root, "p.orchestrate.0");
  assert.match(readFileSync(join(dir, "attempts/0/events.jsonl"), "utf8"), /"costUsd":1/);
  assert.match(readFileSync(join(dir, "events.jsonl"), "utf8"), /"costUsd":2/);
  const job = JSON.parse(readFileSync(join(dir, "job.json"), "utf8"));
  assert.equal(job.costUsdAllAttempts, 3);
  assert.deepEqual(job.attempts.map((a: any) => a.costUsd), [1, 2]);
});

test("unknown failed charge stops dispatch/retry, preserves known lower bound", async (t) => {
  const root = temp(t), run = runFixture();
  let calls = 0;
  const reason = await runScheduler({ jobs: [0, 1].map((rep) => ({ problem: "p", framework: "orchestrate", rep })), config: run.config,
    runPath: root, repoRoot: root, apiKey: "fixture", baseURL: "https://example.invalid", turnLimits: {}, problemsDir: root,
    wait: async () => {}, runAttempt: async () => {
      calls++;
      throw new AttemptFailure("request dropped", { costUsd: null, knownCostUsd: 2, costIncompleteReasons: ["unobserved-failed-model-request"] }, "fixture", 1);
    } }, run);
  assert.equal(reason, "cost-incomplete");
  assert.equal(calls, 1);
  assert.equal(run.totals.costUsd, null);
  assert.equal(run.totals.knownCostUsd, 2);
  assert.equal(run.totals.fail, 1);
});

test("exhausted known-cost failures count all three attempts in final totals", async (t) => {
  const root = temp(t), run = runFixture();
  const reason = await runScheduler({ jobs: [{ problem: "p", framework: "orchestrate", rep: 0 }], config: run.config,
    runPath: root, repoRoot: root, apiKey: "fixture", baseURL: "https://example.invalid", turnLimits: {}, problemsDir: root,
    wait: async () => {}, runAttempt: async () => { throw new AttemptFailure("known failure", { costUsd: 1, knownCostUsd: 1, costIncompleteReasons: [] }, "fixture", 1); } }, run);
  assert.match(reason!, /job-failed/);
  assert.deepEqual(run.totals, { jobs: 1, attempts: 3, costUsd: 3, knownCostUsd: 3, pass: 0, fail: 1 });
});

test("budget reached by failed attempt prevents another paid retry", async (t) => {
  const root = temp(t), run = runFixture(); run.config.budgetUsd = 1;
  let calls = 0;
  const reason = await runScheduler({ jobs: [{ problem: "p", framework: "orchestrate", rep: 0 }], config: run.config,
    runPath: root, repoRoot: root, apiKey: "fixture", baseURL: "https://example.invalid", turnLimits: {}, problemsDir: root,
    wait: async () => {}, runAttempt: async () => { calls++; throw new AttemptFailure("known failure", { costUsd: 1, knownCostUsd: 1, costIncompleteReasons: [] }, "fixture", 1); } }, run);
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
  assert.equal(cost.knownCostUsd, 4);
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

test("recovered findTools selection failure keeps complete attempt cost unknown", async (t) => {
  const { buildFramework, buildRegistry, quickJSRuntime } = await import("@aiw/core");
  const { createReporter, FileSink, LLM_COST_INCOMPLETE_KEY } = await import("@aiw/telemetry");
  const { runLoop } = await import("../src/loop.ts");
  const root = temp(t), eventsPath = join(root, "events.jsonl"), sink = new FileSink(eventsPath);
  const runner = createReporter({ sink, writer: "r" });
  const server = createReporter({ sink, writer: "s" });
  const decls = ["readFile", "runTests"].map(name => ({ name, description: name,
    inputSchema: { type: "object", properties: {} }, meta: { whenToUse: name, effect: "read" as const } }));
  const host = { tools: async () => decls, call: async () => "contents", close: async () => {} };
  const completion = (message: object) => ({ response: { choices: [{ message }] }, usage: { input: 1, output: 1 }, costUsd: 1 });
  let secondaryCalls = 0, selectionCalls = 0, mainCalls = 0;
  const client: import("@aiw/telemetry").LLMClient = { async complete(req) {
    if (!req.tools.length) { selectionCalls++; throw new Error("selection request lost after dispatch"); }
    secondaryCalls++;
    return secondaryCalls === 1 ? completion({ tool_calls: [{ id: "inner", type: "function", function: { name: "branch",
      arguments: JSON.stringify({ code: 'async (tools) => await tools.findTools({ need: "runTests" })' }) } }] })
      : completion({ content: "Ending after failed tool search." });
  } };
  const framework = buildFramework("orchestrate", buildRegistry(decls), { host, runtime: quickJSRuntime,
    orchestrate: { client, model: "fixture", workspaceRoot: root } });
  let outerError: boolean | undefined;
  const loop = await runLoop({ client: { complete: async () => {
    mainCalls++;
    return mainCalls === 1 ? completion({ tool_calls: [{ id: "outer", type: "function", function: { name: "do",
      arguments: JSON.stringify({ instruction: "Inspect task", tools: ["readFile"] }) } }] }) : completion({ content: "Finished." });
  } }, reporter: runner, session: { tools: [], _client: { callTool: async (req: any) => {
    const result = await framework.tools.find(tool => tool.name === "do")!.handle(req.arguments, { reporter: server });
    outerError = result.isError;
    return { content: [{ type: "text", text: result.text }], isError: result.isError };
  } } as any }, systemPrompt: "fixture", taskText: "fixture", model: "fixture", temperature: 0, turnLimit: 5, framework: "orchestrate" });
  sink.close();
  assert.equal(selectionCalls, 1);
  assert.equal(outerError, false, "outer do recovers; its success cannot erase nested charge uncertainty");
  assert.equal(loop.outcome, "done");
  const cost = readAttemptCost(eventsPath, loop.metrics.costIncompleteReasons);
  assert.equal(cost.knownCostUsd, 4);
  assert.equal(cost.costUsd, null);
  assert.deepEqual(cost.costIncompleteReasons, ["unobserved-failed-model-request"]);
  const events = readFileSync(eventsPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(events.filter(event => event.kind === "attach" && event.key === LLM_COST_INCOMPLETE_KEY).length, 1);
});
