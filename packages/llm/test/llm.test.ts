import test from "node:test";
import assert from "node:assert/strict";
import { LLMError, classifyAPIError, createChatClient, normaliseUsage } from "../src/index.ts";

const okBody = (extra: object = {}) => ({
  choices: [{ message: { role: "assistant", content: "hi" }, finish_reason: "stop" }],
  usage: { prompt_tokens: 10, completion_tokens: 3 },
  ...extra,
});

/** Fake fetch recording the request and replying with `status` and `body`. */
function fakeFetch(status: number, body: unknown) {
  const calls: { url: string; body: any }[] = [];
  const f = (async (url: string, init: RequestInit) => {
    calls.push({ url, body: JSON.parse(init.body as string) });
    return new Response(typeof body === "string" ? body : JSON.stringify(body), { status });
  }) as unknown as typeof fetch;
  return { f, calls };
}

const req = { model: "m", system: "sys", tools: [] as unknown[], messages: [{ role: "user", content: "q" }] };

async function rejects(p: Promise<unknown>, kind: string) {
  await assert.rejects(p, (e: unknown) => e instanceof LLMError && e.kind === kind);
}

test("normaliseUsage maps chat-completions usage and omits unreported fields", () => {
  assert.deepEqual(normaliseUsage("openai-chat", okBody()), { usage: { input: 10, output: 3 } });
  const r = normaliseUsage("openai-chat", {
    usage: { prompt_tokens: 10, completion_tokens: 3, cost: 0.002, prompt_tokens_details: { cached_tokens: 4 } },
  });
  assert.deepEqual(r, { usage: { input: 10, output: 3, cachedRead: 4 }, costUsd: 0.002, cacheHit: true });
  const miss = normaliseUsage("openai-chat", { usage: { prompt_tokens: 1, completion_tokens: 1, prompt_tokens_details: { cached_tokens: 0 } } });
  assert.equal(miss.cacheHit, false);
});

test("request body: system first, empty tools omitted, extras passed, OpenRouter usage accounting", async () => {
  const { f, calls } = fakeFetch(200, okBody());
  const c = createChatClient({ baseURL: "https://openrouter.ai/api/v1/", apiKey: "k", fetch: f });
  const res = await c.complete({ ...req, temperature: 0 });
  assert.equal(calls[0].url, "https://openrouter.ai/api/v1/chat/completions");
  assert.deepEqual(calls[0].body, {
    model: "m", temperature: 0, usage: { include: true },
    messages: [{ role: "system", content: "sys" }, { role: "user", content: "q" }],
  });
  assert.deepEqual(res.response, okBody());
  assert.deepEqual(res.usage, { input: 10, output: 3 });
});

test("non-OpenRouter endpoints get no usage flag; tools are sent when present", async () => {
  const { f, calls } = fakeFetch(200, okBody());
  const tool = { type: "function", function: { name: "t", parameters: {} } };
  await createChatClient({ baseURL: "http://x/v1", apiKey: "k", fetch: f }).complete({ ...req, tools: [tool] });
  assert.equal(calls[0].body.usage, undefined);
  assert.deepEqual(calls[0].body.tools, [tool]);
});

test("errors are classified per runner §4.4", async () => {
  const mk = (status: number, body: unknown) =>
    createChatClient({ baseURL: "http://x", apiKey: "k", fetch: fakeFetch(status, body).f }).complete(req);
  await rejects(mk(429, { error: { message: "rate limited" } }), "infra");
  await rejects(mk(502, "bad gateway"), "infra");
  await rejects(mk(400, { error: { message: "This model's maximum context length is 8192 tokens" } }), "context-limit");
  await rejects(mk(400, { error: { message: "invalid tool schema" } }), "other");
  await rejects(mk(200, { error: { code: 502, message: "upstream" } }), "infra");
  await rejects(mk(200, { choices: [{ message: { content: "" }, finish_reason: "stop" }] }), "infra");
  await rejects(mk(200, { choices: [{ message: { content: "x" }, finish_reason: "content_filter" }] }), "infra");
  await rejects(mk(200, "not json"), "infra");
});

test("network failure is infra; caller abort is rethrown as-is", async () => {
  const boom = (async () => { throw new TypeError("fetch failed"); }) as unknown as typeof fetch;
  await rejects(createChatClient({ baseURL: "http://x", apiKey: "k", fetch: boom }).complete(req), "infra");

  const hang = ((_u: string, init: RequestInit) =>
    new Promise((_, rej) => init.signal!.addEventListener("abort", () => rej(init.signal!.reason)))) as unknown as typeof fetch;
  const ac = new AbortController();
  const p = createChatClient({ baseURL: "http://x", apiKey: "k", fetch: hang }).complete({ ...req, signal: ac.signal });
  ac.abort();
  await assert.rejects(p, (e: unknown) => !(e instanceof LLMError));
  // AbortSignal.timeout is unref'd; keep the loop alive while the fake fetch hangs.
  const keep = setTimeout(() => {}, 1000);
  await rejects(createChatClient({ baseURL: "http://x", apiKey: "k", fetch: hang, timeoutMs: 20 }).complete(req), "infra");
  clearTimeout(keep);
});

test("tool-call-only response is not empty", async () => {
  const body = { choices: [{ message: { content: null, tool_calls: [{ id: "1" }] }, finish_reason: "tool_calls" }], usage: {} };
  const r = await createChatClient({ baseURL: "http://x", apiKey: "k", fetch: fakeFetch(200, body).f }).complete(req);
  assert.deepEqual(r.usage, { input: 0, output: 0 });
});

test("classifyAPIError", () => {
  assert.equal(classifyAPIError(undefined, "x"), "infra");
  assert.equal(classifyAPIError(413, "prompt is too long"), "context-limit");
  assert.equal(classifyAPIError(401, "bad key"), "other");
});
