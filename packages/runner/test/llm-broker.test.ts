import { randomUUID } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { ResultSchema, type Request } from "@modelcontextprotocol/sdk/types.js";
import type { LLMClient } from "@aiw/telemetry";
import { installHostLLMBroker, type HostLLMBrokerOptions } from "../src/llm-broker.ts";
import { createHostLLMClient } from "../../server/src/host-client.ts";

/** Establishes a socket-free real MCP protocol session around a mock model client. */
async function fixture(opts: Omit<HostLLMBrokerOptions, "secondaryModel">) {
  const client = new Client({ name: "test", version: "1" }, { capabilities: { experimental: { "aiw/llm/complete": {} } } });
  const server = new Server<Request>({ name: "test-server", version: "1" });
  installHostLLMBroker(client, { ...opts, secondaryModel: "configured-model" });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
  return { client, server, executor: createHostLLMClient(() => server), close: async () => { await client.close(); await server.close(); } };
}
const request = { model: "untrusted-model", system: "system", tools: [], messages: [{ role: "user", content: "task" }] };
const completion = { response: { choices: [{ message: { content: "done" } }] }, usage: { input: 3, output: 1 } };

test("host broker pins model and excludes caller overrides and credentials", async () => {
  let seen: Parameters<LLMClient["complete"]>[0] | undefined;
  const f = await fixture({ secondaryClient: { complete: async (req) => { seen = req; return completion; } } });
  try {
    assert.deepEqual(await f.executor.complete({ ...request, temperature: 99, baseURL: "https://evil.invalid", apiKey: "not-a-credential" }), { ...completion, costUsd: undefined, cacheHit: undefined });
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
