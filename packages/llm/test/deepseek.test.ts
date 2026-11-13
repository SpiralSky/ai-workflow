import { test } from "node:test";
import assert from "node:assert/strict";
import { createDeepSeekClient, deepSeekOffPeakRemaining, deepSeekUsage, DEEPSEEK_ENDPOINT } from "../src/deepseek-client.ts";
import { PRICE_TABLE_VERSION } from "../src/prices.ts";
const good = () => ({ model: "deepseek-flash", choices: [{ finish_reason: "stop", message: { role: "assistant", content: "ok", reasoning_content: "opaque provider history" } }], usage: { prompt_tokens: 10, completion_tokens: 2, prompt_cache_hit_tokens: 4, prompt_cache_miss_tokens: 6, total_tokens: 12 } });
const request = { model: "deepseek-flash", system: "system", tools: [], messages: [] };
const sunday = () => Date.parse("2026-11-01T12:00:00Z");
test("offpeak conservative UTC boundaries including weekend and margin", () => {
  for (const time of ["2026-11-02T00:55:00Z", "2026-11-02T01:00:00Z", "2026-11-02T04:04:59Z", "2026-11-02T05:55:00Z", "2026-11-02T09:59:59Z"]) assert.equal(deepSeekOffPeakRemaining(Date.parse(time)), 0, time);
  for (const time of ["2026-11-02T04:05:00Z", "2026-11-02T10:05:00Z", "2026-11-01T02:00:00Z", "2026-11-06T20:00:00Z"]) assert.ok(deepSeekOffPeakRemaining(Date.parse(time)) > 0, time);
  assert.equal(deepSeekOffPeakRemaining(NaN), 0);
});
test("fixed origin, no redirect, price-table cost, intact thinking and cache", async () => {
  let body: any;
  const client = createDeepSeekClient({ apiKey: "synthetic-key", now: sunday, fetch: (async (url, opts) => {
    assert.equal(url, DEEPSEEK_ENDPOINT); assert.equal(opts?.redirect, "error");
    body = JSON.parse(String(opts?.body)); return Response.json(good());
  }) as typeof fetch });
  const result = await client.complete({ ...request, tools: [{}], messages: [{ role: "assistant", content: "", reasoning_content: "prior", tool_calls: [] }], temperature: 0, baseURL: "https://wrong.invalid" });
  assert.equal(body.messages[1].reasoning_content, "prior"); assert.equal(body.temperature, undefined); assert.equal(body.baseURL, undefined);
  assert.deepEqual(result.usage, { input: 10, output: 2, cachedRead: 4 });
  assert.equal(result.costUsd, (6 * 0.15 + 4 * 0.003 + 2 * 0.6) / 1e6); assert.equal(result.costSource, "price-table"); assert.equal(result.priceTable, PRICE_TABLE_VERSION);
});
test("no dispatch for peak, incomplete history, aliases or cancelled calls", async () => {
  let calls = 0; const fetcher = (async () => { calls++; return Response.json(good()); }) as typeof fetch;
  await assert.rejects(createDeepSeekClient({ apiKey: "x", now: () => Date.parse("2026-11-02T02:00:00Z"), fetch: fetcher }).complete(request), /off-peak/);
  const client = createDeepSeekClient({ apiKey: "x", now: sunday, fetch: fetcher });
  await assert.rejects(client.complete({ ...request, model: "deepseek-v4-flash" }), /Unsupported/);
  await assert.rejects(client.complete({ ...request, tools: [{}], messages: [{ role: "assistant", content: "lost" }] }), /history/);
  await assert.rejects(client.complete({ ...request, signal: AbortSignal.abort() })); assert.equal(calls, 0);
});
test("strict missing/inconsistent usage and sanitized errors", async () => {
  for (const usage of [{}, { ...good().usage, prompt_cache_hit_tokens: -1 }, { ...good().usage, prompt_cache_miss_tokens: 9 }, { ...good().usage, total_tokens: 0 }]) assert.throws(() => deepSeekUsage({ usage }), /usage/);
  for (const fetcher of [(async () => { throw new Error("synthetic-secret https://secret.invalid"); }), (async () => Response.json({ error: { message: "synthetic-secret" } }, { status: 401 }))]) {
    await assert.rejects(createDeepSeekClient({ apiKey: "synthetic-secret", now: sunday, fetch: fetcher as typeof fetch }).complete(request), e => !String(e).includes("synthetic-secret") && !String(e).includes("secret.invalid"));
  }
});
test("late transport completion after cancellation is rejected without leaking abort reason", async () => {
  const controller = new AbortController();
  const client = createDeepSeekClient({ apiKey: "synthetic", now: sunday, fetch: (async () => {
    controller.abort(new Error("synthetic-secret")); return Response.json(good());
  }) as typeof fetch });
  await assert.rejects(client.complete({ ...request, signal: controller.signal }), e => /cancelled/.test(String(e)) && !String(e).includes("synthetic-secret"));
});
test("near-boundary full timeout refuses dispatch and pre-abort reason is sanitized", async () => {
  let calls = 0;
  const client = createDeepSeekClient({ apiKey: "synthetic", now: () => Date.parse("2026-11-02T00:53:00Z"), fetch: (async () => { calls++; return Response.json(good()); }) as typeof fetch });
  await assert.rejects(client.complete(request), /off-peak/);
  await assert.rejects(client.complete({ ...request, signal: AbortSignal.abort(new Error("synthetic-secret")) }), e => /cancelled/.test(String(e)) && !String(e).includes("synthetic-secret"));
  assert.equal(calls, 0);
});
test("pending transport receives cancellation, with sanitized error", async () => {
  const controller = new AbortController(); let started!: () => void;
  const ready = new Promise<void>(resolve => { started = resolve; });
  const client = createDeepSeekClient({ apiKey: "synthetic", now: sunday, fetch: ((_url, init) => new Promise((_resolve, reject) => {
    init!.signal!.addEventListener("abort", () => reject(new Error("synthetic-secret")), { once: true }); started();
  })) as typeof fetch });
  const promise = client.complete({ ...request, signal: controller.signal });
  await ready; controller.abort(new Error("synthetic-secret"));
  await assert.rejects(promise, e => /cancelled/.test(String(e)) && !String(e).includes("synthetic-secret"));
});
