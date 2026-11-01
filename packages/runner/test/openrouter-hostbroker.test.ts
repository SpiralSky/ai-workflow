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
import { createChatClient } from "@aiw/llm";
import { installHostLLMBroker } from "../src/llm-broker.ts";
import { createHostLLMClient } from "../../server/src/host-client.ts";
import { readAttemptCost } from "../src/accounting.ts";
import { frameworkLaunch } from "../src/framework-launch.ts";
import { startContainer, startServer, dockerClientEnvironment } from "../src/container.ts";
import type { RunConfig } from "../src/types.ts";

const secret = "SENTINEL-OPENROUTER-KEY-NOT-IN-TASK";
const endpoint = "https://openrouter.ai/api/v1";

test("all provider variants use credential-free host launch and network-none container metadata", async () => {
  for (const provider of [undefined, "openrouter", "chatgpt"] as const) {
    for (const id of ["orchestrate", "orchestrate[rerank=none,secondary=2]"]) {
      const launch = frameworkLaunch(id, { provider, models: { main: "main", secondary: "secondary" }, secondaryCap: 4 } as RunConfig);
      const commands: unknown[] = [];
      const ctr = await startContainer("fixture", "/fixture/job", "/fixture/bundle", launch.network, async (cmd, args) => {
        commands.push({ cmd, args }); assert.equal(args[args.indexOf("--network") + 1], "none");
        assert.ok(!args.includes("--env") && !args.includes("-e")); return { stdout: "fixture-container" };
      });
      const descriptor = await startServer(ctr, launch.executorArgs, { OPENROUTER_API_KEY: secret, OPENAI_API_KEY: secret, OPENAI_BASE_URL: endpoint });
      assert.ok(launch.executorArgs.includes("host"));
      assert.doesNotMatch(JSON.stringify({ launch, ctr, commands, descriptor }), /SENTINEL|openrouter\.ai|executor-api-key|executor-base-url/);
    }
  }
  assert.deepEqual(dockerClientEnvironment({ PATH: "/bin", DOCKER_CONTEXT: "fixture", OPENROUTER_API_KEY: secret,
    OPENAI_BASE_URL: endpoint, ARBITRARY_SECRET: secret }), { PATH: "/bin", DOCKER_CONTEXT: "fixture" });
});

test("mock OpenRouter main, selection and executor use pinned host client with unchanged monetary/cache accounting", { timeout: 15000 }, async t => {
  const root = mkdtempSync(join(tmpdir(), "aiw-openrouter-broker-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  writeFileSync(join(root, "a.ts"), "export const answer = 42;\n");
  const events = join(root, "events.jsonl"), sink = new FileSink(events);
  const bodies: any[] = [], wire: unknown[] = [];
  const messages = [{ content: "main plan" }, { content: '["readFile"]' },
    { tool_calls: [{ id: "call_1", type: "function", function: { name: "branch", arguments: JSON.stringify({ code: 'async (tools) => await tools.readFile({ q: "a.ts" })' }) } }] },
    { content: "Read file: @s1.c1" }];
  const provider = createChatClient({ baseURL: endpoint, apiKey: secret, fetch: (async (url, init) => {
    assert.equal(url, `${endpoint}/chat/completions`);
    assert.equal((init!.headers as Record<string, string>).authorization, `Bearer ${secret}`);
    const body = JSON.parse(String(init!.body)); bodies.push(body);
    const message = messages[bodies.length - 1]; assert.ok(message, "no unplanned requests");
    return new Response(JSON.stringify({ model: "provider-observed-model", choices: [{ message }],
      usage: { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 2 }, cost: bodies.length } }));
  }) as typeof fetch });
  const client = new Client({ name: "host", version: "1" }, { capabilities: { experimental: { "aiw/llm/complete": {} } } });
  const server = new Server<Request>({ name: "task", version: "1" });
  const admission = installHostLLMBroker(client, { secondaryClient: provider, secondaryModel: "pinned-secondary" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  for (const transport of [ct, st]) {
    const send = transport.send.bind(transport);
    transport.send = async (message, options) => { wire.push(JSON.parse(JSON.stringify(message))); await send(message, options); };
  }
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    admission.open(); // Fixture represents successful persisted runtime attestation.
    await wrapLLM(provider, createReporter({ sink, writer: "r" }), "main").complete({ model: "pinned-main", temperature: 0, system: "fixture", tools: [], messages: [] });
    const decls: HostToolDecl[] = [{ name: "readFile", description: "Read file", inputSchema: { type: "object", properties: { q: { type: "string" } } }, meta: { whenToUse: "read file", effect: "read" } }];
    const host: Host = { tools: async () => decls, call: async () => "export const answer = 42;", close: async () => {} };
    const framework = buildFramework("orchestrate", buildRegistry(decls), { host,
      orchestrate: { client: createHostLLMClient(() => server), model: "untrusted-task-model", workspaceRoot: root, rerank: "llm" } });
    const result = await framework.tools.find(tool => tool.name === "do")!.handle({ instruction: "read file a.ts" }, { reporter: createReporter({ sink, writer: "s" }) });
    assert.equal(result.isError, false, result.text);
    assert.equal(bodies.length, 4);
    assert.equal(bodies[0].model, "pinned-main"); assert.equal(bodies[0].temperature, 0);
    for (const body of bodies.slice(1)) {
      assert.equal(body.model, "pinned-secondary");
      assert.equal(Object.hasOwn(body, "temperature"), false, "legacy secondary omitted temperature; do not invent a default");
      assert.deepEqual(body.usage, { include: true });
      assert.ok(!Object.hasOwn(body, "provider") && !Object.hasOwn(body, "baseURL"));
    }
    const lines = readFileSync(events, "utf8"), turns = lines.trim().split("\n").map(line => JSON.parse(line)).filter((event: any) => event.kind === "turn");
    assert.deepEqual(turns.map((event: any) => event.role), ["main", "selection", "secondary", "secondary"]);
    assert.deepEqual(turns.map((event: any) => event.costUsd), [1, 2, 3, 4]);
    assert.ok(turns.every((event: any) => event.cacheHit === true && event.usage.cachedRead === 2));
    assert.equal(readAttemptCost(events).costUsd, 10, "four provider charges counted exactly once");
    assert.doesNotMatch(JSON.stringify({ wire, bodies, result, lines }), /SENTINEL|https:\/\/openrouter/);
  } finally { admission.close(); await client.close(); await server.close(); sink.close(); }
});

for (const scenario of ["json-error", "nonjson-error", "error-in-200", "empty-response", "transport", "context-limit"] as const) {
  test(`main ${scenario} diagnostics cannot leak provider secrets into loop artifacts`, async t => {
    const { runLoop } = await import("../src/loop.ts");
    const root = mkdtempSync(join(tmpdir(), "aiw-provider-error-")); t.after(() => rmSync(root, { recursive: true, force: true }));
    const path = join(root, "events.jsonl"), sink = new FileSink(path);
    const provider = createChatClient({ baseURL: endpoint, apiKey: secret, fetch: (async () => {
      if (scenario === "transport") throw new Error(`${endpoint} Authorization: Bearer ${secret}`);
      if (scenario === "nonjson-error") return new Response(`${secret} ${endpoint}`, { status: 500 });
      if (scenario === "empty-response") return new Response(JSON.stringify({ debug: secret, choices: [] }));
      return new Response(JSON.stringify({ error: { code: 500, message: `${scenario === "context-limit" ? "maximum context length" : "failed"} ${secret} ${endpoint}` } }),
        { status: scenario === "error-in-200" ? 200 : scenario === "context-limit" ? 400 : 500 });
    }) as typeof fetch });
    try {
      const result = await runLoop({ client: provider, reporter: createReporter({ sink, writer: "r" }),
        session: { tools: [], _client: {} as any }, systemPrompt: "fixture", taskText: "fixture", model: "fixture", temperature: 0, turnLimit: 1, framework: "baseline" });
      assert.equal(result.outcome, scenario === "context-limit" ? "context-limit" : "infra-error");
      writeFileSync(join(root, "result.json"), JSON.stringify(result));
      assert.doesNotMatch(readFileSync(path, "utf8") + readFileSync(join(root, "result.json"), "utf8"), /SENTINEL|openrouter\.ai/);
    } finally { sink.close(); }
  });
}
