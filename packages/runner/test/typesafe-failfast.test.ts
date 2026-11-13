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
import { createTypeSafeDecisionsClient, type DecisionsClient } from "@aiw/llm";
import { createReporter, FileSink } from "@aiw/telemetry";
import { buildRegistry, classifierReranker } from "@aiw/core";
import { createHostClassifierClient } from "../../server/src/host-classifier.ts";
import { installHostLLMBroker } from "../src/llm-broker.ts";
import { readAttemptCost } from "../src/accounting.ts";
import { resolveConfig, type EvalFlags } from "../src/config.ts";
import { createCostMeter } from "../src/cost-meter.ts";
import { frameworkLaunch } from "../src/framework-launch.ts";
const request = { instruction: "read file", candidates: [{ id: "c0", name: "read", whenToUse: "read file" }] };
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
for (const scenario of ["missing-usage", "missing-model", "billed-failure"] as const) test(`direct classifier ${scenario} stops actual loop before executor and next main`, async t => {
  const { buildFramework } = await import("@aiw/core");
  const { runLoop } = await import("../src/loop.ts");
  const dir = mkdtempSync(join(tmpdir(), "aiw-classifier-failfast-")); t.after(() => rmSync(dir, { recursive: true, force: true }));
  const path = join(dir, "events.jsonl"), sink = new FileSink(path); t.after(() => sink.close());
  let classifierCalls = 0, executorCalls = 0, mainCalls = 0, failures = 0;
  const meter = createCostMeter(1);
  const bounded = meter.classifier(createTypeSafeDecisionsClient({ apiKey: "SENTINEL", model: "jev-1.14.0", fetch: (async () => {
    classifierCalls++;
    return Response.json({ answers: { c0: { type: "noul", noul: 0.9 } },
      ...(scenario !== "missing-model" ? { model: "jev-1.14.0" } : {}),
      ...(scenario !== "missing-usage" ? { usage: { input_tokens: 100, output_tokens: 10 } } : {}),
      ...(scenario === "billed-failure" ? { error: { message: "SENTINEL" } } : {}) }, { status: scenario === "billed-failure" ? 500 : 200 });
  }) as typeof fetch }));
  const f = await fixture(bounded); t.after(f.close); f.gate.open();
  const declarations = [{ name: "read", description: "read file", inputSchema: {}, meta: { whenToUse: "read file", effect: "read" as const } }];
  const framework = buildFramework("orchestrate", buildRegistry(declarations), {
    variant: { rerank: "classifier" }, host: { tools: async () => declarations, call: async () => "data", close: async () => {} },
    orchestrate: { workspaceRoot: dir, model: "executor", classifier: { client: f.classifier, model: "jev-1.14.0", threshold: 0.8, policy: "noul-v1" },
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
  // A billed failure is fully priced; missing usage or model leaves the attempt cost unknown.
  const cost = readAttemptCost(path); assert.equal(cost.costUsd, scenario === "billed-failure" ? cost.knownCostUsd : null); assert.equal(cost.knownCostUsd, 0.01 + (scenario === "billed-failure" ? 100 * 0.042 / 1e6 : 0));
  if (scenario === "billed-failure") assert.equal(meter.snapshot().knownCostUsd, 100 * 0.042 / 1e6);
  else assert.equal(meter.stopReason(), "cost-incomplete");
});
