import test from "node:test";
import assert from "node:assert/strict";
import { onCancellation } from "../src/cancellation.ts";
import { callTool, type MCPSession } from "../src/mcp.ts";

test("cancellation action fires once, handles already-aborted signals, and cleanup awaits settlement", async () => {
  for (const already of [false, true]) {
    const controller = new AbortController();
    if (already) controller.abort();
    let release!: () => void;
    let called = 0, settled = false;
    const gate = new Promise<void>((resolve) => { release = resolve; });
    const cleanup = onCancellation(controller.signal, async () => { called++; await gate; settled = true; });
    controller.abort();
    const closing = cleanup();
    await Promise.resolve();
    assert.equal(called, 1); assert.equal(settled, false);
    release(); await closing;
    assert.equal(settled, true);
  }
});

test("normal cleanup detaches the kill action", async () => {
  const controller = new AbortController();
  let called = false;
  await onCancellation(controller.signal, async () => { called = true; })();
  controller.abort(); await Promise.resolve();
  assert.equal(called, false);
});

test("MCP receives the campaign signal and no request starts after cancellation", async () => {
  const controller = new AbortController();
  let calls = 0;
  const session = { tools: [], _client: { callTool: async (_req: unknown, _schema: unknown, opts: { signal: AbortSignal }) => {
    calls++; assert.equal(opts.signal, controller.signal);
    return new Promise((_resolve, reject) => { opts.signal.addEventListener("abort", () => reject(opts.signal.reason), { once: true }); });
  } } } as unknown as MCPSession;
  const pending = callTool(session, "do", {}, { "aiw/parent": "r:1", "aiw/harnessId": "call1" }, controller.signal);
  controller.abort(new Error("campaign stopped"));
  await assert.rejects(pending, /campaign stopped/);
  await assert.rejects(callTool(session, "do", {}, { "aiw/parent": "r:2", "aiw/harnessId": "call2" }, controller.signal), /campaign stopped/);
  assert.equal(calls, 1);
});

test("pre-cancelled production job records zero known spend without container or model setup", async (t) => {
  const { mkdtempSync, rmSync, readFileSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const { runJobAttempt } = await import("../src/job.ts");
  const { resolveConfig } = await import("../src/config.ts");
  const { AttemptFailure } = await import("../src/accounting.ts");
  const root = mkdtempSync(join(tmpdir(), "aiw-pre-cancel-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = resolveConfig({ problems: "p", mode: "baseline", tools: "S", reps: 1, model: "fixture", temperature: 0,
    budget: 1, full: false, branchContext: "trace", secondaryCap: 4 }, [{ id: "p", size: "small", set: "dev" }]);
  const controller = new AbortController(); controller.abort(new Error("campaign already stopped"));
  let notified = 0;
  await assert.rejects(runJobAttempt({ job: { problem: "p", framework: "baseline", rep: 0 }, config, runPath: root,
    repoRoot: root, apiKey: "fixture", baseURL: "https://example.invalid", problemsDir: root, turnLimits: {},
    signal: controller.signal, onFailure: () => { notified++; } }), (error: unknown) => {
      assert.ok(error instanceof AttemptFailure);
      assert.match(error.message, /campaign already stopped/);
      assert.equal(error.cost.costUsd, 0);
      assert.equal(error.cost.knownCostUsd, 0);
      return true;
    });
  assert.equal(notified, 1);
  const events = readFileSync(join(root, "p.baseline.0", "events.jsonl"), "utf8");
  assert.doesNotMatch(events, /"kind":"turn"/);
});

test("transport failure stops before another model call but ordinary tool errors remain recoverable", async () => {
  const { runLoop } = await import("../src/loop.ts");
  const { createReporter, NoopSink } = await import("@aiw/telemetry");
  for (const transportFailure of [false, true]) {
    let requests = 0, notified = 0;
    const outcome = await runLoop({ client: { complete: async () => ({ response: { choices: [{ message: ++requests === 1
      ? { tool_calls: [{ id: "t", function: { name: "read_file", arguments: "{}" } }] } : { content: "done" } }] },
      usage: { input: 1, output: 1 }, costUsd: 1 }) },
      reporter: createReporter({ sink: new NoopSink(), writer: "r" }),
      session: { tools: [], _client: { callTool: async () => {
        if (transportFailure) throw new Error("MCP transport disconnected");
        return { isError: true, content: [{ type: "text", text: "file not found: correct the path" }] };
      } } as any }, systemPrompt: "fixture", taskText: "fixture", model: "fixture", temperature: 0,
      turnLimit: 3, framework: "baseline", onInfraError: () => { notified++; } });
    assert.equal(outcome.outcome, transportFailure ? "infra-error" : "done");
    assert.equal(requests, transportFailure ? 1 : 2);
    assert.equal(notified, transportFailure ? 1 : 0);
  }
});
