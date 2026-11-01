import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Request } from "@modelcontextprotocol/sdk/types.js";
import { buildFramework, buildRegistry, type Host, type HostToolDecl } from "@aiw/core";
import { selectRuntime } from "../../core/src/branch/index.ts";
import { createReporter, type EventRecord, type Sink } from "@aiw/telemetry";
import { createChatGPTClient } from "@aiw/llm";
import { installHostLLMBroker } from "../src/llm-broker.ts";
import { createHostLLMClient } from "../../server/src/host-client.ts";
import { boundSubscriptionClient } from "../src/subscription.ts";

/** A real orchestrate engine and MCP protocol with mocked Responses traffic; never opens a socket. */
test("orchestrate selection and executor complete through host SIWC broker with full tool history", { timeout: 15_000 }, async () => {
  const workspace = await mkdtemp(join(tmpdir(), "aiw-chatgpt-orchestrate-"));
  await writeFile(join(workspace, "a.ts"), "export const answer = 42;\n");
  const calls: { url: string; body: any }[] = [];
  const wire: unknown[] = [];
  const events: EventRecord[] = [];
  const toolCalls: unknown[] = [];
  const fixtureSecret = "fixture-bearer-never-leaves-host";
  const text = (value: string) => [{ type: "message", role: "assistant", content: [{ type: "output_text", text: value }] }];
  const outputs = [text('["readFile"]'), [{ type: "function_call", namespace: "ai_workflow", name: "branch", call_id: "call_1", id: "fn_1",
    arguments: JSON.stringify({ code: 'async (tools) => { return await tools.readFile({ q: "a.ts" }); }' }) }], text("Read the file: see @s1.c1.")];
  const provider = createChatGPTClient({ accessToken: async () => fixtureSecret, fetch: (async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/responses");
    assert.equal((init!.headers as Record<string, string>).authorization, `Bearer ${fixtureSecret}`);
    const body = JSON.parse(String(init!.body));
    const output = outputs[calls.length];
    assert.ok(output, "no unplanned provider calls");
    calls.push({ url: String(url), body });
    const event = { type: "response.completed", response: { id: `response_${calls.length}`, model: "selected-secondary", status: "completed", output,
      usage: { input_tokens: 10, output_tokens: 5, input_tokens_details: { cached_tokens: 2 } } } };
    return new Response(`data: ${JSON.stringify(event)}\n\n`, { headers: { "content-type": "text/event-stream" } });
  }) as typeof fetch });
  const bounded = boundSubscriptionClient(provider, { maxCalls: 3, maxTokens: 100, maxDurationMs: 10_000 });
  const client = new Client({ name: "host", version: "1" }, { capabilities: { experimental: { "aiw/llm/complete": {} } } });
  const server = new Server<Request>({ name: "task-container", version: "1" });
  installHostLLMBroker(client, { secondaryClient: bounded.client, secondaryModel: "selected-secondary" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  for (const transport of [ct, st]) {
    const send = transport.send.bind(transport);
    transport.send = async (message, options) => { wire.push(JSON.parse(JSON.stringify(message))); await send(message, options); };
  }
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    const declarations: HostToolDecl[] = [{ name: "readFile", description: "Read the contents of a file", inputSchema: { type: "object", properties: { q: { type: "string" } }, required: ["q"] },
      meta: { whenToUse: "read the contents of a file", effect: "read" } }];
    const host: Host = { tools: async () => declarations, call: async (req) => { toolCalls.push(req); return "export const answer = 42;"; }, close: async () => {} };
    const { runtime } = await selectRuntime("quickjs");
    const framework = buildFramework("orchestrate", buildRegistry(declarations), { host, runtime,
      orchestrate: { client: createHostLLMClient(() => server), model: "untrusted-container-model", workspaceRoot: workspace, rerank: "llm" } });
    const reporter = createReporter({ sink: { write: (event: EventRecord) => { events.push(event); } } as Sink, writer: "s" });
    const result = await framework.tools.find((tool) => tool.name === "do")!.handle({ instruction: "read the contents of a file a.ts" }, { reporter });
    assert.equal(result.isError, false, result.text);
    assert.match(result.text, /Read the file: see @s1.c1/);
    assert.match(result.text, /Step: s1/);
    assert.equal(toolCalls.length, 1);
    const resolved = await framework.tools.find((tool) => tool.name === "resolve")!.handle({ ref: "@s1.c1" }, { reporter });
    assert.equal(resolved.text, "export const answer = 42;");
    assert.equal(calls.length, 3, "one selection and two executor calls");
    assert.ok(calls.every((call) => call.body.model === "selected-secondary" && call.body.stream === true && call.body.store === false));
    assert.ok(calls[2].body.input.some((item: any) => item.type === "function_call" && item.call_id === "call_1"));
    assert.ok(calls[2].body.input.some((item: any) => item.type === "function_call_output" && item.call_id === "call_1"));
    assert.equal(bounded.snapshot().completedCalls, 3);
    assert.equal(bounded.snapshot().inputTokens, 30);
    assert.equal(bounded.snapshot().outputTokens, 15);
    assert.equal(bounded.snapshot().cachedReadTokens, 6);
    const turns = events.filter((event) => event.kind === "turn");
    assert.deepEqual(turns.map((event: any) => event.role), ["selection", "secondary", "secondary"]);
    assert.ok(turns.every((event: any) => event.costUsd === undefined), "plan usage is not zero-dollar API usage");
    assert.doesNotMatch(JSON.stringify({ wire, calls, events, result }), new RegExp(fixtureSecret));
  } finally { await client.close(); await server.close(); await rm(workspace, { recursive: true, force: true }); }
});
