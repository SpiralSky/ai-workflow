import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResultSchema, InitializeRequestSchema, ListToolsRequestSchema, type Request } from "@modelcontextprotocol/sdk/types.js";
import type { LLMClient } from "@aiw/telemetry";
import { installHostLLMBroker, type HostLLMBrokerOptions } from "../src/llm-broker.ts";
import { createHostLLMClient } from "../../server/src/host-client.ts";

/** Establishes a socket-free real MCP protocol session around a mock model client. */
async function fixture(opts: Omit<HostLLMBrokerOptions, "secondaryModel">) {
  const client = new Client({ name: "test", version: "1" }, { capabilities: { experimental: { "aiw/llm/complete": {} } } });
  const server = new Server<Request>({ name: "test-server", version: "1" });
  const admission = installHostLLMBroker(client, { ...opts, secondaryModel: "configured-model" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
  admission.open(); // Mock fixture explicitly represents successful persisted attestation.
  return { client, server, admission, executor: createHostLLMClient(() => server), close: async () => { await client.close(); await server.close(); } };
}
const request = { model: "untrusted-model", system: "system", tools: [], messages: [{ role: "user", content: "task" }] };
const completion = { response: { choices: [{ message: { content: "done" } }] }, usage: { input: 3, output: 1 } };

test("host broker pins model and excludes caller overrides and credentials", async () => {
  let seen: Parameters<LLMClient["complete"]>[0] | undefined;
  const f = await fixture({ secondaryClient: { complete: async (req) => { seen = req; return completion; } } });
  try {
    assert.deepEqual(await f.executor.complete({ ...request, temperature: 99, baseURL: "https://evil.invalid", apiKey: "not-a-credential" }), { ...completion, costUsd: undefined, costSource: undefined, priceTable: undefined, cacheHit: undefined });
    assert.equal(seen?.model, "configured-model");
    assert.equal(seen?.baseURL, undefined);
    assert.equal(seen?.apiKey, undefined);
    assert.equal(seen?.temperature, undefined);
    assert.deepEqual(seen?.messages, request.messages);
    assert.ok(seen?.signal instanceof AbortSignal);
  } finally { await f.close(); }
});

test("malformed or oversized peer requests cannot dispatch inference", async () => {
  let calls = 0;
  const f = await fixture({ maxRequestBytes: 100, secondaryClient: { complete: async () => { calls++; return completion; } } });
  try {
    await assert.rejects(f.server.request({ method: "aiw/llm/complete", params: { requestId: randomUUID(), system: "s", tools: [], messages: [], model: "evil" } }, ResultSchema));
    await assert.rejects(f.server.request({ method: "aiw/llm/complete", params: { requestId: randomUUID(), system: "x".repeat(200), tools: [], messages: [] } }, ResultSchema), /size limit/);
    assert.equal(calls, 0);
  } finally { await f.close(); }
});

test("provider diagnostics never cross the host broker", async () => {
  const f = await fixture({ secondaryClient: { complete: async () => { throw new Error("Bearer secret-fixture"); } } });
  try {
    await assert.rejects(f.server.request({ method: "aiw/llm/complete", params: { requestId: randomUUID(), system: "s", tools: [], messages: [] } }, ResultSchema), (error: Error) => {
      assert.match(error.message, /Host LLM request failed/);
      assert.doesNotMatch(error.message, /secret-fixture|Bearer/);
      return true;
    });
  } finally { await f.close(); }
});

test("campaign abort prevents later broker dispatch", async () => {
  const campaign = new AbortController();
  let calls = 0;
  const f = await fixture({ signal: campaign.signal, secondaryClient: { complete: async () => { calls++; return completion; } } });
  try {
    campaign.abort();
    await assert.rejects(f.executor.complete(request), /Host LLM request failed/);
    assert.equal(calls, 0);
  } finally { await f.close(); }
});

for (const mode of ["cancel", "close"] as const) {
  test(`MCP ${mode} aborts in-flight host inference`, async () => {
    let entered!: () => void;
    const started = new Promise<void>((resolve) => { entered = resolve; });
    let stopped!: () => void;
    const aborted = new Promise<void>((resolve) => { stopped = resolve; });
    const f = await fixture({ secondaryClient: { complete: async (req) => {
      entered();
      return new Promise((_resolve, reject) => {
        (req.signal as AbortSignal).addEventListener("abort", () => { stopped(); reject(new Error("abort")); }, { once: true });
      });
    } } });
    const controller = new AbortController();
    try {
      const pending = f.executor.complete({ ...request, signal: controller.signal });
      const rejection = assert.rejects(pending);
      await started;
      if (mode === "cancel") controller.abort(); else await f.client.close();
      await aborted;
      await rejection;
    } finally { await f.close(); }
  });
}

test("host executor refuses peers lacking explicit broker capability", async () => {
  const server = new Server<Request>({ name: "server", version: "1" });
  await assert.rejects(createHostLLMClient(() => server).complete(request), /broker is not available/);
});

test("replayed broker request IDs never trigger a second model request", async () => {
  let calls = 0;
  const f = await fixture({ secondaryClient: { complete: async () => { calls++; return completion; } } });
  const params = { requestId: randomUUID(), system: "s", tools: [], messages: [] };
  try {
    await f.server.request({ method: "aiw/llm/complete", params }, ResultSchema);
    await assert.rejects(f.server.request({ method: "aiw/llm/complete", params }, ResultSchema), /ID reused/);
    assert.equal(calls, 1);
    await f.close();
    await assert.rejects(f.executor.complete(request));
    assert.equal(calls, 1);
  } finally { await f.close(); }
});

test("duplicate active broker IDs reject before dispatch; original still cancels", async () => {
  let calls = 0, entered!: () => void, stopped!: () => void;
  const started = new Promise<void>((resolve) => { entered = resolve; });
  const aborted = new Promise<void>((resolve) => { stopped = resolve; });
  const campaign = new AbortController();
  const f = await fixture({ signal: campaign.signal, secondaryClient: { complete: async (req) => {
    calls++; entered();
    return new Promise((_resolve, reject) => {
      (req.signal as AbortSignal).addEventListener("abort", () => { stopped(); reject(new Error("abort")); }, { once: true });
    });
  } } });
  const params = { requestId: randomUUID(), system: "s", tools: [], messages: [] };
  try {
    const pending = f.server.request({ method: "aiw/llm/complete", params }, ResultSchema);
    const rejection = assert.rejects(pending);
    await started;
    await assert.rejects(f.server.request({ method: "aiw/llm/complete", params }, ResultSchema), /ID reused/);
    campaign.abort();
    await aborted; await rejection;
    assert.equal(calls, 1);
  } finally { await f.close(); }
});

test("first reverse request timeout cancels host inference, including MCP numeric ID zero", async () => {
  let stopped!: () => void;
  const aborted = new Promise<void>((resolve) => { stopped = resolve; });
  const f = await fixture({ secondaryClient: { complete: async (req) => new Promise((_resolve, reject) => {
    (req.signal as AbortSignal).addEventListener("abort", () => { stopped(); reject(new Error("abort")); }, { once: true });
  }) } });
  try {
    const executor = createHostLLMClient(() => f.server, { timeoutMs: 20 });
    await assert.rejects(executor.complete(request), /Host LLM request failed/);
    await aborted;
  } finally { await f.close(); }
});

test("main and reverse-MCP secondary share one serialized call budget", async () => {
  const { boundSubscriptionClient } = await import("../src/subscription.ts");
  let active = 0, peak = 0, secondStarted!: () => void, releaseSecond!: () => void;
  const started = new Promise<void>((resolve) => { secondStarted = resolve; });
  const gate = new Promise<void>((resolve) => { releaseSecond = resolve; });
  const models: string[] = [];
  const bounded = boundSubscriptionClient({ complete: async (req) => {
    models.push(req.model); active++; peak = Math.max(peak, active);
    if (models.length === 1) await new Promise((resolve) => setTimeout(resolve, 10));
    else { secondStarted(); await gate; }
    active--;
    return completion;
  } }, { maxCalls: 2, maxTokens: 100, maxDurationMs: 5000 });
  const f = await fixture({ secondaryClient: bounded.client });
  try {
    const main = bounded.client.complete({ ...request, model: "configured-main" });
    const secondary = f.executor.complete({ ...request, model: "untrusted-secondary" });
    await started;
    const overLimit = assert.rejects(bounded.client.complete({ ...request, model: "configured-main" }), /subscription-call-limit/);
    releaseSecond();
    await Promise.all([main, secondary, overLimit]);
    assert.deepEqual(models, ["configured-main", "configured-model"]);
    assert.equal(peak, 1);
    assert.equal(bounded.snapshot().calls, 2);
    assert.equal(bounded.snapshot().completedCalls, 2);
    assert.equal(bounded.snapshot().inputTokens, 6);
    assert.equal(bounded.snapshot().outputTokens, 2);
  } finally { releaseSecond(); await f.close(); }
});

test("adversarial initialize and tools/list reverse requests reject before admission without consuming allowance", async () => {
  const { boundSubscriptionClient } = await import("../src/subscription.ts");
  let calls = 0;
  const bounded = boundSubscriptionClient({ complete: async () => { calls++; return completion; } },
    { maxCalls: 5, maxTokens: 100, maxDurationMs: 10000 });
  const client = new Client({ name: "test", version: "1" }, { capabilities: { experimental: { "aiw/llm/complete": {} } } });
  const server = new Server<Request>({ name: "adversarial-fixture", version: "1" }, { capabilities: { tools: {} } });
  const admission = installHostLLMBroker(client, { secondaryClient: bounded.client, secondaryModel: "fixture" });
  const reverse = () => server.request({ method: "aiw/llm/complete", params: { requestId: randomUUID(), system: "fixture", messages: [], tools: [] } }, ResultSchema);
  let denied = 0;
  server.setRequestHandler(InitializeRequestSchema, async req => {
    await assert.rejects(reverse(), /admission is closed/); denied++;
    return { protocolVersion: req.params.protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "fixture", version: "1" } };
  });
  server.setRequestHandler(ListToolsRequestSchema, async () => {
    await assert.rejects(reverse(), /admission is closed/); denied++;
    return { tools: [] };
  });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  try {
    await Promise.all([client.connect(ct), server.connect(st)]);
    await client.listTools();
    assert.equal(denied, 2); assert.equal(calls, 0); assert.equal(bounded.snapshot().calls, 0);
    // Handshake completion alone must not open admission.
    await assert.rejects(reverse(), /admission is closed/);
    assert.equal(calls, 0);
    admission.open(); // Represents verification and persistence succeeding, not an approval.
    await Promise.resolve();
    assert.equal(calls, 0, "rejected startup requests must never be queued for later execution");
    await reverse();
    assert.equal(calls, 1); assert.equal(bounded.snapshot().calls, 1);
    admission.close();
    await assert.rejects(reverse(), /admission is closed/);
    assert.throws(() => admission.open());
    assert.equal(calls, 1);
  } finally { await client.close(); await server.close(); }
});

test("campaign cancellation permanently revokes admission even before it opens", async () => {
  const campaign = new AbortController();
  const client = new Client({ name: "fixture", version: "1" });
  let calls = 0;
  const admission = installHostLLMBroker(client, { signal: campaign.signal, secondaryModel: "fixture",
    secondaryClient: { complete: async () => { calls++; return completion; } } });
  campaign.abort();
  assert.throws(() => admission.open());
  assert.equal(calls, 0);
});

test("raw peer provider, model, endpoint and generation overrides are rejected before dispatch", async () => {
  let calls = 0;
  const f = await fixture({ secondaryClient: { complete: async () => { calls++; return completion; } } });
  try {
    for (const override of [{ provider: "other" }, { model: "other" }, { baseURL: "https://other.invalid" }, { apiKey: "SENTINEL" },
      { temperature: 0.9 }, { top_p: 0.5 }, { max_tokens: 99999 }]) {
      await assert.rejects(f.server.request({ method: "aiw/llm/complete", params: { requestId: randomUUID(), system: "s", tools: [], messages: [], ...override } }, ResultSchema));
    }
    assert.equal(calls, 0);
  } finally { await f.close(); }
});

test("MCP cancellation aborts pending mocked OpenRouter HTTP traffic without retries", async () => {
  const { createChatClient } = await import("@aiw/llm");
  let entered!: () => void, stopped!: () => void, calls = 0;
  const started = new Promise<void>(resolve => { entered = resolve; });
  const aborted = new Promise<void>(resolve => { stopped = resolve; });
  const provider = createChatClient({ baseURL: "https://openrouter.ai/api/v1", apiKey: "SENTINEL-PRIVATE",
    fetch: (async (_url, init) => {
      calls++; entered();
      return new Promise((_resolve, reject) => {
        init!.signal!.addEventListener("abort", () => { stopped(); reject(new Error("SENTINEL-PRIVATE transport aborted")); }, { once: true });
      });
    }) as typeof fetch });
  const f = await fixture({ secondaryClient: provider });
  const cancel = new AbortController();
  try {
    const pending = f.executor.complete({ ...request, signal: cancel.signal });
    const rejected = assert.rejects(pending, error => !String(error).includes("SENTINEL"));
    await started; cancel.abort(); await aborted; await rejected;
    assert.equal(calls, 1);
  } finally { await f.close(); }
});

test("broker preserves allowlisted provider error kinds/status without raw diagnostics", async () => {
  const { createChatClient, LLMError } = await import("@aiw/llm");
  for (const [status, message, kind] of [[400, "maximum context length", "context-limit"], [429, "rate limit", "infra"], [401, "invalid key", "other"]] as const) {
    const f = await fixture({ secondaryClient: createChatClient({ baseURL: "https://openrouter.ai/api/v1", apiKey: "SENTINEL-KEY",
      fetch: (async () => new Response(JSON.stringify({ error: { message: `${message} SENTINEL-KEY https://private-endpoint.invalid` } }), { status })) as typeof fetch }) });
    try {
      await assert.rejects(f.executor.complete(request), error => {
        assert.ok(error instanceof LLMError);
        assert.equal(error.kind, kind); assert.equal(error.status, status);
        assert.doesNotMatch(String(error), /SENTINEL|private-endpoint|maximum context|invalid key/);
        return true;
      });
      await assert.rejects(f.server.request({ method: "aiw/llm/complete", params: { requestId: randomUUID(), system: "s", tools: [], messages: [] } }, ResultSchema), (error: any) => {
        assert.deepEqual(error.data, { aiwLLMError: { kind, status } });
        assert.doesNotMatch(JSON.stringify(error), /SENTINEL|private-endpoint/);
        return true;
      });
    } finally { await f.close(); }
  }
});
