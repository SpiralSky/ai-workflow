import { test } from "node:test";
import assert from "node:assert/strict";
import { createOpenAIClient, openAIUsage, OPENAI_ENDPOINT } from "../src/openai-client.ts";
import { PRICE_TABLE_VERSION } from "../src/prices.ts";
const good = (tier?: string) => ({ ...(tier ? { service_tier: tier } : {}), choices: [{ finish_reason: "stop", message: { role: "assistant", content: "ok" } }],
  usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, prompt_tokens_details: { cached_tokens: 4 } } });
const request = { model: "gpt-6-luna", system: "system", tools: [], messages: [{ role: "user", content: "hi" }] };
const clientFor = (fetcher: (...a: any[]) => Promise<Response>) => createOpenAIClient({ apiKey: "synthetic-key", fetch: fetcher as typeof fetch });

test("request asks for Flex on the fixed endpoint, without redirect or temperature", async () => {
  let body: any, init: any;
  const client = clientFor(async (url, opts) => { assert.equal(url, OPENAI_ENDPOINT); init = opts; body = JSON.parse(String(opts.body)); return Response.json(good("flex")); });
  await client.complete({ ...request, temperature: 0 } as any);
  assert.equal(init.redirect, "error"); assert.equal(init.headers.authorization, "Bearer synthetic-key");
  assert.equal(body.service_tier, "flex"); assert.equal(body.model, "gpt-6-luna"); assert.equal(body.stream, false);
  assert.equal(body.temperature, undefined); assert.equal(body.tools, undefined);
  assert.deepEqual(body.messages, [{ role: "system", content: "system" }, { role: "user", content: "hi" }]);
  await clientFor(async (_u, opts) => { body = JSON.parse(String(opts.body)); return Response.json(good("flex")); }).complete({ ...request, tools: [{ type: "function" }] });
  assert.deepEqual(body.tools, [{ type: "function" }]);
});
test("flex response is priced at flex rates, default at standard rates", async () => {
  const flex = await clientFor(async () => Response.json(good("flex"))).complete(request);
  assert.deepEqual(flex.usage, { input: 10, output: 2, cachedRead: 4 }); assert.equal(flex.cacheHit, true);
  assert.equal(flex.costUsd, (6 * 0.05 + 4 * 0.005 + 2 * 0.25) / 1e6); assert.equal(flex.costSource, "price-table"); assert.equal(flex.priceTable, PRICE_TABLE_VERSION);
  const std = await clientFor(async () => Response.json(good("default"))).complete(request);
  assert.equal(std.costUsd, (6 * 0.10 + 4 * 0.01 + 2 * 0.50) / 1e6);
});
test("missing or unknown service_tier yields no cost fields", async () => {
  for (const tier of [undefined, "auto", "priority", "scale"]) {
    const r = await clientFor(async () => Response.json(good(tier))).complete(request);
    assert.equal(r.costUsd, undefined); assert.equal(r.costSource, undefined); assert.equal(r.priceTable, undefined);
    assert.deepEqual(r.usage, { input: 10, output: 2, cachedRead: 4 });
  }
});
test("strict missing/inconsistent usage is infra", () => {
  const u = good().usage;
  for (const usage of [undefined, {}, { ...u, prompt_tokens: -1 }, { ...u, prompt_tokens_details: undefined }, { ...u, prompt_tokens_details: { cached_tokens: 11 } },
    { ...u, total_tokens: 0 }, { ...u, completion_tokens: 1.5 }]) {
    assert.throws(() => openAIUsage({ service_tier: "flex", usage }), (e: any) => e.kind === "infra" && /usage/.test(e.message));
  }
});
test("429 Resource Unavailable is infra", async () => {
  await assert.rejects(clientFor(async () => Response.json({ error: { message: "Resource Unavailable" } }, { status: 429 })).complete(request), (e: any) => e.kind === "infra");
});
test("wrong model is rejected without a request", async () => {
  let calls = 0; const client = clientFor(async () => { calls++; return Response.json(good("flex")); });
  await assert.rejects(client.complete({ ...request, model: "gpt-5" }), (e: any) => e.kind === "other");
  await assert.rejects(client.complete({ ...request, signal: AbortSignal.abort() })); assert.equal(calls, 0);
});
test("incomplete responses are infra", async () => {
  const bad = [{ choices: [] }, { choices: [{ finish_reason: "length", message: { content: "x" } }], usage: good().usage },
    { choices: [{ finish_reason: "stop", message: { content: "" } }], usage: good().usage }];
  for (const b of bad) await assert.rejects(clientFor(async () => Response.json(b)).complete(request), (e: any) => e.kind === "infra" && /incomplete/.test(e.message));
});
