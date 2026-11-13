import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResultSchema, InitializeRequestSchema, CallToolRequestSchema, type Request } from "@modelcontextprotocol/sdk/types.js";
import { createDecisionsClient, type DecisionsClient } from "@aiw/llm";
import { createReporter, FileSink } from "@aiw/telemetry";
import { buildRegistry, classifierReranker } from "@aiw/core";
import { createHostClassifierClient } from "../../server/src/host-classifier.ts";
import { installHostLLMBroker } from "../src/llm-broker.ts";
import { readAttemptCost } from "../src/accounting.ts";
import { resolveConfig, type EvalFlags } from "../src/config.ts";
import { frameworkLaunch } from "../src/framework-launch.ts";
const request = { instruction: "read file", candidates: [{ id: "c0", name: "read", whenToUse: "read file" }] };
const base = { problems: "x", mode: "orchestrate[rerank=classifier]", tools: "S", reps: 1, model: "deepseek/deepseek-v4-flash", temperature: 0, budget: 1, full: false, branchContext: "trace", secondaryCap: 4, classifierModel: "typesafe/jev-1.14", classifierThreshold: 0.8 } satisfies EvalFlags;

test("classifier config is explicit, pinned, host-only and cannot mix incompatible accounting", () => {
  const config = resolveConfig(base, []);
  const launch = frameworkLaunch(config.frameworks[0], config);
  assert.equal(launch.network, "none"); assert.ok(launch.executorArgs.includes("--classifier-model"));
  assert.doesNotMatch(JSON.stringify(launch), /https:|api-key|base-url/);
  for (const override of [{ classifierModel: undefined }, { classifierThreshold: undefined }, { classifierModel: "generic/chat" }, { classifierThreshold: 0.5 }, { mode: "orchestrate" }]) {
    assert.throws(() => resolveConfig({ ...base, ...override }, []));
  }
  assert.throws(() => frameworkLaunch(config.frameworks[0], { ...config, provider: "deepseek" }));
  assert.throws(() => frameworkLaunch(config.frameworks[0], { ...config, provider: "chatgpt" }));
  assert.equal(resolveConfig({ ...base, mode: "orchestrate", classifierModel: undefined, classifierThreshold: undefined }, []).classifier, undefined);
});
async function fixture(classifier: DecisionsClient, early = false) {
  const client = new Client({ name: "host", version: "1" }, { capabilities: { experimental: { "aiw/classifier/classify": {} } } });
  const server = new Server<Request>({ name: "task", version: "1" }, { capabilities: { tools: {} } });
  const gate = installHostLLMBroker(client, { secondaryClient: { complete: async () => { throw new Error("No paid chat fallback"); } }, secondaryModel: "secondary", classifierClient: classifier });
  let rejected = false;
  if (early) server.setRequestHandler(InitializeRequestSchema, async () => {
    await assert.rejects(server.request({ method: "aiw/classifier/classify", params: { ...request, requestId: randomUUID() } }, ResultSchema), /admission is closed/);
    rejected = true;
    return { protocolVersion: "2025-03-26", capabilities: {}, serverInfo: { name: "task", version: "1" } };
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, server, gate, rejected, classifier: createHostClassifierClient(() => server), close: async () => { gate.close(); await client.close(); await server.close(); } };
}
test("real MCP typed decisions denies startup/overrides/replays, accounts malformed billed answers exactly once", async t => {
  let calls = 0;
  const secret = "CLASSIFIER-SENTINEL-KEY";
  const model = createDecisionsClient({ apiKey: secret, model: base.classifierModel, fetch: (async (url, init) => {
    calls++; assert.equal(url, "https://openrouter.ai/api/alpha/decisions");
    const body = JSON.parse(String(init!.body)); assert.equal(body.model, base.classifierModel); assert.equal(body.provider.allow_fallbacks, false);
    assert.doesNotMatch(String(init!.body), /CLASSIFIER-SENTINEL/);
    return new Response(JSON.stringify({ model: base.classifierModel, answers: { wrong: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 10, output_tokens: 1, cost: 0.03 } }));
  }) as typeof fetch });
  const early = await fixture(model, true);
  assert.equal(early.rejected, true); assert.equal(calls, 0); await early.close();
  const f = await fixture(model); t.after(f.close); f.gate.open();
  for (const key of ["provider", "model", "threshold", "apiKey", "baseURL", "temperature"]) {
    await assert.rejects(f.server.request({ method: "aiw/classifier/classify", params: { ...request, requestId: randomUUID(), [key]: "override" } }, ResultSchema));
  }
  assert.equal(calls, 0);
  const dir = mkdtempSync(join(tmpdir(), "aiw-classifier-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "events.jsonl"), sink = new FileSink(path), reporter = createReporter({ sink, writer: "r" });
  const tools = buildRegistry([{ name: "read", description: "read file", inputSchema: {}, meta: { whenToUse: "read file", effect: "read" } }]).decls;
  const reranker = classifierReranker(f.classifier, { model: base.classifierModel, threshold: 0.8, policy: "noul-v1" });
  assert.deepEqual(await reranker.rerank("read file", tools, { reporter }), tools);
  await sink.close(); assert.equal(readAttemptCost(path).costUsd, 0.03); assert.equal(calls, 1);
  const id = randomUUID();
  await f.server.request({ method: "aiw/classifier/classify", params: { ...request, requestId: id } }, ResultSchema);
  await assert.rejects(f.server.request({ method: "aiw/classifier/classify", params: { ...request, requestId: id } }, ResultSchema), /reused/);
  f.gate.close(); await assert.rejects(f.classifier.classify(request)); assert.equal(calls, 2);
});
test("unknown classifier usage invalidates cost completeness but retains known lower bound", async t => {
  const dir = mkdtempSync(join(tmpdir(), "aiw-classifier-cost-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "events.jsonl"), sink = new FileSink(path), reporter = createReporter({ sink, writer: "r" });
  reporter.turn({ role: "selection", model: base.classifierModel, latencyMs: 1, costUsd: 0.04 });
  await sink.close(); const cost = readAttemptCost(path);
  assert.equal(cost.costUsd, null); assert.equal(cost.knownCostUsd, 0.04); assert.ok(cost.costIncompleteReasons.includes("missing-turn-usage"));
});
test("classifier cancellation aborts pending host traffic and never retries", async t => {
  let entered!: () => void, stopped!: () => void;
  const started = new Promise<void>(r => entered = r), aborted = new Promise<void>(r => stopped = r);
  let calls = 0;
  const f = await fixture({ classify: async req => { calls++; entered(); return new Promise((_resolve, reject) => {
    req.signal!.addEventListener("abort", () => { stopped(); reject(new Error("SECRET")); }, { once: true });
  }); } }); t.after(f.close); f.gate.open();
  const control = new AbortController(); const pending = f.classifier.classify({ ...request, signal: control.signal });
  await started; control.abort(); await assert.rejects(pending, /cancelled/); await aborted; assert.equal(calls, 1);
});


test("unknown classifier accounting stops real orchestrate MCP tool before executor and next main turn", async t => {
  const { buildFramework } = await import("@aiw/core");
  const { runLoop } = await import("../src/loop.ts");
  const dir = mkdtempSync(join(tmpdir(), "aiw-classifier-failfast-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "events.jsonl"), sink = new FileSink(path); t.after(() => sink.close());
  let classifierCalls = 0, executorCalls = 0, mainCalls = 0, failures = 0;
  const f = await fixture({ classify: async () => { classifierCalls++; return { answers: { c0: { type: "noul", noul: 0.9 } },
    providerModel: base.classifierModel, costUsd: 0.04 }; } }); t.after(f.close); f.gate.open();
  const declarations = [{ name: "read", description: "read file", inputSchema: {}, meta: { whenToUse: "read file", effect: "read" as const } }];
  const framework = buildFramework("orchestrate", buildRegistry(declarations), {
    variant: { rerank: "classifier" }, host: { tools: async () => declarations, call: async () => "data", close: async () => {} },
    orchestrate: { workspaceRoot: dir, model: "executor", classifier: { client: f.classifier, model: base.classifierModel, threshold: 0.8, policy: "noul-v1" },
      client: { complete: async () => { executorCalls++; throw new Error("executor must not start"); } } },
  });
  f.server.setRequestHandler(CallToolRequestSchema, async req => {
    const result = await framework.tools.find(tool => tool.name === req.params.name)!.handle(req.params.arguments ?? {}, { reporter: createReporter({ sink, writer: "s" }) });
    return { isError: result.isError, content: [{ type: "text", text: result.text }] };
  });
  const result = await runLoop({ session: { _client: f.client, tools: framework.tools.map(tool => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) },
    client: { complete: async () => { mainCalls++; return { response: { choices: [{ message: { tool_calls: [{ id: "do1", type: "function", function: { name: "do", arguments: JSON.stringify({ instruction: "read file" }) } }] } }] }, usage: { input: 10, output: 2 }, costUsd: 0.01 }; } },
    reporter: createReporter({ sink, writer: "r" }), systemPrompt: "fixture", taskText: "read file", model: "main", temperature: 0, turnLimit: 4,
    framework: "orchestrate[rerank=classifier]", onInfraError: () => { failures++; },
  });
  assert.equal(result.outcome, "infra-error"); assert.equal(classifierCalls, 1); assert.equal(executorCalls, 0); assert.equal(mainCalls, 1); assert.ok(failures > 0);
  const cost = readAttemptCost(path); assert.equal(cost.costUsd, null); assert.equal(cost.knownCostUsd, 0.05);
});
