import test from "node:test";
import assert from "node:assert/strict";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import type { Request } from "@modelcontextprotocol/sdk/types.js";
import type { LLMClient, NativeLLMCompletion } from "@aiw/telemetry";
import { installHostLLMBroker } from "../src/llm-broker.ts";
import { createHostLLMClient } from "../../server/src/host-client.ts";
const request = { model: "native-label", system: "s\n界", messages: [{ role: "tool", tool_call_id: "c1", content: 'escaped " text' }], tools: [] };
const completion: NativeLLMCompletion = { response: { choices: [{ message: { content: "fixture" } }] }, usage: null,
  usageStatus: "unavailable", usageReason: "native-harness-unreported", completionEvidence: {
    completionId: "fixture-completion", requestSHA256: "a".repeat(64), responseSHA256: "b".repeat(64),
  } };
/** Real in-memory MCP endpoints; all completions are deterministic fixtures. */
async function fixture(nativeHost: boolean, nativeBroker: boolean, complete: LLMClient["complete"]) {
  const client = new Client({ name: "host", version: "1" }, { capabilities: { experimental: { "aiw/llm/complete": {} } } });
  const server = new Server<Request>({ name: "server", version: "1" });
  const admission = installHostLLMBroker(client, { secondaryClient: { complete }, secondaryModel: request.model, ...(nativeBroker ? { nativeMode: true } : {}) });
  const [ct, st] = InMemoryTransport.createLinkedPair();
  await Promise.all([client.connect(ct), server.connect(st)]);
  admission.open();
  return { executor: createHostLLMClient(() => server, nativeHost ? { nativeMode: { model: request.model } } : {}),
    close: async () => { await client.close(); await server.close(); } };
}
test("negotiated native broker retains full payload and unknown receipt metadata", async () => {
  const seen: unknown[] = [];
  const f = await fixture(true, true, async req => { seen.push(req); return completion; });
  try {
    assert.deepEqual(await f.executor.complete(request), completion);
    assert.equal(seen.length, 1);
    const { signal, ...payload } = seen[0] as Parameters<LLMClient["complete"]>[0];
    assert.deepEqual(payload, request);
  } finally { await f.close(); }
});
test("native projection rejects every unsupported control before broker dispatch", async () => {
  let calls = 0;
  const f = await fixture(true, true, async () => { calls++; return completion; });
  try {
    for (const bad of [{ model: "mismatch" }, { temperature: undefined }, { temperature: 0 }, { maxTokens: 1 }, { max_tokens: 1 }, { max_output_tokens: 1 }, { extra: true }]) {
      await assert.rejects(f.executor.complete({ ...request, ...bad }), /Unsupported native request/);
    }
    assert.equal(calls, 0);
  } finally { await f.close(); }
});
for (const [host, broker] of [[true, false], [false, true]]) test(`native mode mismatch rejects before dispatch (${host}/${broker})`, async () => {
  let calls = 0;
  const f = await fixture(host!, broker!, async () => { calls++; return completion; });
  try { await assert.rejects(f.executor.complete(request)); assert.equal(calls, 0); } finally { await f.close(); }
});
for (const native of [false, true]) test(`broker rejects wrong accounting branch (${native})`, async () => {
  const f = await fixture(native, native, async () => native ? { response: {}, usage: { input: 1, output: 1 } } : completion);
  try { await assert.rejects(f.executor.complete(request)); } finally { await f.close(); }
});
