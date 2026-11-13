import test from "node:test";
import assert from "node:assert/strict";
import { createChatGPTClient, listChatGPTModels } from "../src/chatgpt-client.ts";
import { LLMError } from "../src/errors.ts";

const req = { model: "account-selected-model", system: "Follow the task", tools: [] as unknown[], messages: [{ role: "user", content: "Fix tests" }] };
const textOutput = [{ type: "message", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "Done ✓" }] }];
const completion = (extra: object = {}) => ({ type: "response.completed", response: {
  id: "r1", model: req.model, status: "completed", output: textOutput,
  usage: { input_tokens: 12, output_tokens: 4, input_tokens_details: { cached_tokens: 3 } }, ...extra,
} });
/** In-memory SSE only: no sockets, credentials, or upstream requests. */
function stream(events: unknown[], chunkSize = 11): Response {
  const bytes = new TextEncoder().encode(events.map(e => `data: ${typeof e === "string" ? e : JSON.stringify(e)}\r\n\r\n`).join(""));
  let index = 0;
  return new Response(new ReadableStream({ pull(c) {
    if (index >= bytes.length) c.close();
    else { c.enqueue(bytes.slice(index, index + chunkSize)); index += chunkSize; }
  } }), { headers: { "content-type": "text/event-stream; charset=utf-8" } });
}
/** Record only test fixture transport requests. */
function fixture(events: unknown[] = [completion()]) {
  const calls: { url: string; init: RequestInit; body: any }[] = [];
  const fetcher = (async (url: string, init: RequestInit) => {
    calls.push({ url, init, body: init.body ? JSON.parse(String(init.body)) : undefined });
    return stream(events);
  }) as typeof fetch;
  const client = createChatGPTClient({ accessToken: async () => "mock-secret", fetch: fetcher });
  return { calls, client };
}

test("SIWC uses fixed public Responses and safe preview settings, tokens not provenance", async () => {
  const { client, calls } = fixture();
  const result = await client.complete({ ...req, temperature: 0, max_output_tokens: 99, previous_response_id: "r0", metadata: { secret: "none" } });
  assert.equal(calls[0].url, "https://api.openai.com/v1/responses");
  assert.equal(calls[0].init.redirect, "error");
  assert.deepEqual(calls[0].body, { model: req.model, instructions: req.system, input: req.messages, store: false, stream: true });
  assert.deepEqual(result.usage, { input: 12, output: 4, cachedRead: 3 });
  assert.equal(result.cacheHit, true);
  assert.equal(result.costUsd, undefined);
  assert.ok(!JSON.stringify(result).includes("mock-secret"));
  const message = (result.response as any).choices[0].message;
  assert.equal(message.content, "Done ✓");
  assert.deepEqual(message.responses_output, textOutput);
});

test("functions are namespaced with explicit non-strict compatibility, without hosted search", async () => {
  const { client, calls } = fixture();
  await client.complete({ ...req, tools: [{ type: "function", function: { name: "read_file", description: "Read", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] } } }] });
  assert.deepEqual(calls[0].body.tools, [{ type: "namespace", name: "ai_workflow", description: "AI Workflow client-executed tools", tools: [{ type: "function", name: "read_file", description: "Read", parameters: { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, strict: false }] }]);
});

test("full reasoning and namespaced parallel tool outputs survive the next stateless request", async () => {
  const output = [{ type: "reasoning", id: "rs", summary: [], encrypted_content: "opaque-test-reasoning" },
    { type: "function_call", namespace: "ai_workflow", name: "read_file", arguments: '{"path":"a"}', call_id: "c1", id: "f1" },
    { type: "function_call", namespace: "ai_workflow", name: "read_file", arguments: '{"path":"b"}', call_id: "c2", id: "f2" }];
  const { client, calls } = fixture([completion({ output })]);
  const first = await client.complete(req);
  const msg = (first.response as any).choices[0].message;
  assert.deepEqual(msg.tool_calls.map((c: any) => c.id), ["c1", "c2"]);
  await client.complete({ ...req, messages: [...req.messages, msg, { role: "tool", tool_call_id: "c1", content: "file a" }, { role: "tool", tool_call_id: "c2", content: "file b" }] });
  assert.deepEqual(calls[1].body.input, [...req.messages, ...output,
    { type: "function_call_output", call_id: "c1", output: "file a" }, { type: "function_call_output", call_id: "c2", output: "file b" }]);
});

test("legacy chat history maps tool results and system messages without duplicate assistant text", async () => {
  const { client, calls } = fixture();
  await client.complete({ ...req, messages: [{ role: "system", content: "policy" }, { role: "assistant", content: "Reading", tool_calls: [{ id: "c1", function: { name: "read_file", arguments: "{}" } }] }, { role: "tool", tool_call_id: "c1", content: "result" }] });
  assert.deepEqual(calls[0].body.input, [{ role: "developer", content: "policy" }, { role: "assistant", content: "Reading" }, { type: "function_call", call_id: "c1", namespace: "ai_workflow", name: "read_file", arguments: "{}" }, { type: "function_call_output", call_id: "c1", output: "result" }]);
});

for (const terminal of [
  { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded", message: "mock-secret" } } },
  { type: "response.incomplete", response: { incomplete_details: { reason: "max_output_tokens" } } },
  { type: "error", message: "mock-secret" },
  "[DONE]",
]) test(`partial stream cannot succeed: ${typeof terminal === "string" ? terminal : terminal.type}`, async () => {
  const { client } = fixture([{ type: "response.output_text.delta", delta: "partial" }, terminal]);
  await assert.rejects(client.complete(req), (e: unknown) => e instanceof LLMError && !e.message.includes("mock-secret"));
});

test("EOF before terminal, malformed events, invalid terminal status, missing usage fail closed", async () => {
  for (const events of [[], [{ type: "response.output_text.delta", delta: "text" }], ["not-json"], [completion({ status: "incomplete" })], [completion({ usage: {} })]]) {
    await assert.rejects(fixture(events).client.complete(req), LLMError);
  }
});

test("context-window error is classified without provider message disclosure", async () => {
  await assert.rejects(fixture([{ type: "response.failed", response: { error: { code: "context_length_exceeded", message: "secret" } } }]).client.complete(req),
    (e: unknown) => e instanceof LLMError && e.kind === "context-limit" && !e.message.includes("secret"));
});

test("HTTP and transport errors do not echo upstream secrets and are never retried", async () => {
  for (const status of [401, 429, 500, 302]) {
    let calls = 0;
    const client = createChatGPTClient({ accessToken: async () => "mock-secret", fetch: (async () => { calls++; return new Response("mock-secret", { status }); }) as typeof fetch });
    await assert.rejects(client.complete(req), (e: unknown) => e instanceof LLMError && !e.message.includes("mock-secret"));
    assert.equal(calls, 1);
  }
  const client = createChatGPTClient({ accessToken: async () => "mock-secret", fetch: (async () => { throw new Error("mock-secret"); }) as typeof fetch });
  await assert.rejects(client.complete(req), { message: "ChatGPT request failed" });
});

test("non-SSE success and unsupported output cannot pass as completed", async () => {
  const client = createChatGPTClient({ accessToken: async () => "mock", fetch: (async () => new Response(JSON.stringify(completion()), { headers: { "content-type": "application/json" } })) as typeof fetch });
  await assert.rejects(client.complete(req), /not an event stream/);
  await assert.rejects(fixture([completion({ output: [{ type: "web_search_call" }] })]).client.complete(req), /Unsupported/);
  await assert.rejects(fixture([completion({ output: [{ type: "function_call", namespace: "attacker", name: "read_file", call_id: "c", arguments: "{}" }] })]).client.complete(req), /Malformed/);
});

test("invalid usage counts are not silently treated as zero", async () => {
  for (const usage of [undefined, { input_tokens: -1, output_tokens: 0 }, { input_tokens: 2, output_tokens: 1.5 }, { input_tokens: 1, output_tokens: 1, input_tokens_details: { cached_tokens: 4 } }]) {
    await assert.rejects(fixture([completion({ usage })]).client.complete(req), LLMError);
  }
});

test("pre-aborted requests do not read credentials or call transport", async () => {
  const controller = new AbortController(); controller.abort(new Error("cancelled"));
  const client = createChatGPTClient({ accessToken: async () => { assert.fail("credential lookup"); }, fetch: (async () => { assert.fail("transport"); }) as typeof fetch });
  await assert.rejects(client.complete({ ...req, signal: controller.signal }), controller.signal.reason);
});

test("abort cancels a pending SSE reader and preserves caller reason", async () => {
  const controller = new AbortController(); let cancelled = false;
  let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const client = createChatGPTClient({ accessToken: async () => "mock", fetch: (async () => new Response(new ReadableStream({ start() { started(); }, cancel() { cancelled = true; } }), { headers: { "content-type": "text/event-stream" } })) as typeof fetch });
  const pending = client.complete({ ...req, signal: controller.signal });
  await ready;
  // Let the adapter install its cancellation listener after receiving headers.
  await new Promise(resolve => setImmediate(resolve));
  controller.abort(new Error("campaign stopped"));
  await assert.rejects(pending, controller.signal.reason);
  assert.equal(cancelled, true);
});

test("model discovery uses selected credential and preserves catalog ordering", async () => {
  let actualSignal: AbortSignal | undefined;
  const models = await listChatGPTModels({ accessToken: async signal => { actualSignal = signal; return "mock"; }, fetch: (async (url, init) => {
    assert.equal(url, "https://api.openai.com/v1/models"); assert.equal(init?.redirect, "error"); assert.equal(init?.signal, actualSignal);
    return Response.json({ models: [{ slug: "b", display_name: "B", visibility: "list" }, { slug: "hide", display_name: "Hidden", visibility: "hidden" }, { slug: "a", display_name: "A", visibility: "list" }] });
  }) as typeof fetch });
  assert.deepEqual(models, [{ slug: "b", display_name: "B" }, { slug: "a", display_name: "A" }]);
});

test("model discovery rejects malformed catalog and sanitizes endpoint failures", async () => {
  for (const body of [{ data: [] }, { models: [{ visibility: "list", slug: 5 }] }]) {
    await assert.rejects(listChatGPTModels({ accessToken: async () => "mock", fetch: (async () => Response.json(body)) as typeof fetch }), /malformed/);
  }
  await assert.rejects(listChatGPTModels({ accessToken: async () => { throw new Error("mock-secret"); } }), { message: "ChatGPT request failed" });
});

test("hosted tools, duplicate names, and invalid history are rejected before credential lookup", async () => {
  let lookups = 0;
  const client = createChatGPTClient({ accessToken: async () => { lookups++; return "mock"; } });
  for (const tools of [[{ type: "tool_search" }], [{ type: "function", function: { name: "a" } }, { type: "function", function: { name: "a" } }]]) {
    await assert.rejects(client.complete({ ...req, tools }), LLMError);
  }
  await assert.rejects(client.complete({ ...req, messages: [{ role: "intruder", content: "hi" }] }), LLMError);
  assert.equal(lookups, 0);
});


test("HTTP context-limit and quota codes are preserved without echoing arbitrary provider details", async () => {
  for (const code of ["context_length_exceeded", "subscription_sharing_usage_limit_exceeded"]) {
    const client = createChatGPTClient({ accessToken: async () => "mock", fetch: (async () => Response.json({ error: { code, message: "mock-secret" } }, { status: 400 })) as typeof fetch });
    await assert.rejects(client.complete(req), (e: unknown) => e instanceof LLMError && e.message.includes(code) && !e.message.includes("mock-secret") && (code !== "context_length_exceeded" || e.kind === "context-limit"));
  }
});
