import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Request } from "@modelcontextprotocol/sdk/types.js";
import { buildFramework, buildRegistry, type Host, type HostToolDecl } from "@aiw/core";
import { createReporter, FileSink, wrapLLM } from "@aiw/telemetry";
import { createTypeSafeDecisionsClient, createDeepSeekClient } from "@aiw/llm";
import { installHostLLMBroker } from "../src/llm-broker.ts";
import { boundClassifierEstimatedClient } from "../src/classifier-estimated.ts";
import { boundEstimatedClient } from "../src/estimated.ts";
import { createHostClassifierClient } from "../../server/src/host-classifier.ts";
import { createHostLLMClient } from "../../server/src/host-client.ts";
import { readAttemptCost } from "../src/accounting.ts";
import { frameworkLaunch } from "../src/framework-launch.ts";
import { startContainer, startServer, dockerClientEnvironment } from "../src/container.ts";
import type { RunConfig } from "../src/types.ts";

const secret = "SENTINEL-OPENROUTER-KEY-NOT-IN-TASK";
const endpoint = "https://api.deepseek.com";

test("direct DeepSeek plus TypeSafe orchestration uses no OpenRouter and accounts each provider once", { timeout: 15000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "aiw-openrouter-broker-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "a.ts"), "export const answer = 42;\n");
  const events = join(root, "events.jsonl"), sink = new FileSink(events);
  const bodies: any[] = [], wire: unknown[] = [];
  const messages = [{ content: "main plan" },
    { tool_calls: [{ id: "call_1", type: "function", function: { name: "branch", arguments: JSON.stringify({ code: 'async (tools) => await tools.readFile({ q: "a.ts" })' }) } }] },
    { content: "Read file: @s1.c1" }];
  const provider = createDeepSeekClient({ now: () => Date.parse("2026-11-01T12:00:00Z"), apiKey: secret, fetch: (async (url, init) => {
    assert.equal(url, `${endpoint}/chat/completions`);
    assert.equal((init!.headers as Record<string, string>).authorization, `Bearer ${secret}`);
    const body = JSON.parse(String(init!.body)); bodies.push(body);
    const message = messages[bodies.length - 1]; assert.ok(message, "no unplanned requests");
    return new Response(JSON.stringify({ model: "provider-observed-model", choices: [{ finish_reason: message.tool_calls ? "tool_calls" : "stop", message: { ...message, reasoning_content: `thinking-${bodies.length}` } }],
      usage: { prompt_tokens: 10, completion_tokens: 5, prompt_cache_hit_tokens: 2, prompt_cache_miss_tokens: 8 } }));
  }) as typeof fetch });
  const limits = { maxCalls: 10, maxTokens: 10000, maxDurationMs: 30000, estimateLimitUsd: 1 };
  const deepseek = boundEstimatedClient(provider, limits);
  let decisions = 0;
  const classifier = boundClassifierEstimatedClient(createTypeSafeDecisionsClient({ apiKey: "TYPESAFE-SENTINEL", model: "jev-1.14.0", fetch: (async (url, init) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone"); decisions++;
    const body = JSON.parse(String(init!.body)); assert.equal(body.model, "jev-1.14.0"); assert.equal(body.provider, undefined);
    return Response.json({ model: "jev-1.14.0", answers: Object.fromEntries(Object.keys(body.questions).map(id => [id, { type: "noul", noul: 0.9 }])), usage: { input_tokens: 100, output_tokens: 10 } });
  }) as typeof fetch }), limits);
  const client = new Client({ name: "host", version: "1" }, { capabilities: { experimental: { "aiw/llm/complete": {}, "aiw/classifier/classify": {} } } });
  const server = new Server<Request>({ name: "task", version: "1" });
  const admission = installHostLLMBroker(client, { classifierClient: classifier.client, secondaryClient: deepseek.client, secondaryModel: "deepseek-flash" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  for (const transport of [ct, st]) {
    const send = transport.send.bind(transport);
    transport.send = async (message, options) => { wire.push(JSON.parse(JSON.stringify(message))); await send(message, options); };
  }
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    admission.open(); // Fixture represents successful persisted runtime attestation.
    await wrapLLM(deepseek.client, createReporter({ sink, writer: "r" }), "main").complete({ model: "deepseek-flash", temperature: 0, system: "fixture", tools: [], messages: [] });
    const decls: HostToolDecl[] = [{ name: "readFile", description: "Read file", inputSchema: { type: "object", properties: { q: { type: "string" } } }, meta: { whenToUse: "read file", effect: "read" } }];
    const host: Host = { tools: async () => decls, call: async () => "export const answer = 42;", close: async () => {} };
    const framework = buildFramework("orchestrate", buildRegistry(decls), { host,
      orchestrate: { client: createHostLLMClient(() => server), model: "untrusted-task-model", workspaceRoot: root, rerank: "classifier", classifier: { client: createHostClassifierClient(() => server), model: "jev-1.14.0", threshold: 0.8, policy: "noul-v1" } } });
    const result = await framework.tools.find(tool => tool.name === "do")!.handle({ instruction: "read file a.ts" }, { reporter: createReporter({ sink, writer: "s" }) });
    assert.equal(result.isError, false, result.text);
    assert.equal(bodies.length, 3); assert.equal(decisions, 1);
    assert.equal(classifier.snapshot().calls, 1); assert.equal(deepseek.snapshot().calls, 3);
    assert.equal(bodies[0].model, "deepseek-flash"); assert.equal(bodies[0].temperature, undefined);
    for (const body of bodies.slice(1)) {
      assert.equal(body.model, "deepseek-flash");
      assert.equal(Object.hasOwn(body, "temperature"), false, "legacy secondary omitted temperature; do not invent a default");
      assert.equal(body.usage, undefined);
      assert.ok(!Object.hasOwn(body, "provider") && !Object.hasOwn(body, "baseURL"));
    }
    const lines = readFileSync(events, "utf8"), turns = lines.trim().split("\n").map(line => JSON.parse(line)).filter((event: any) => event.kind === "turn");
    assert.deepEqual(turns.map((event: any) => event.role), ["main", "selection", "secondary", "secondary"]);
    assert.ok(turns.every((event: any) => event.costUsd === undefined && (event.deepseekEstimate?.estimatedUsd ?? event.classifierEstimate?.estimatedUsd) > 0));
    assert.equal(bodies[2].messages.find((m: any) => m.role === "assistant").reasoning_content, "thinking-2");
    assert.ok(turns.filter((e: any) => e.role !== "selection").every((event: any) => event.cacheHit === true && event.usage.cachedRead === 2));
    assert.equal(readAttemptCost(events).costUsd, null, "estimates never masquerade as measured dollars");
    assert.doesNotMatch(JSON.stringify({ wire, bodies, result, lines }), /SENTINEL|https:\/\/openrouter/);
  } finally { admission.close(); await client.close(); await server.close(); sink.close(); }
});
