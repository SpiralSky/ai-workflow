import test from "node:test";
import assert from "node:assert/strict";
import { createTypeSafeDecisionsClient, TYPESAFE_MODEL } from "../src/decisions-client.ts";
import { PRICE_TABLE_VERSION } from "../src/prices.ts";
const req = { instruction: "read file", candidates: [{ id: "c0", name: "readFile", whenToUse: "read file" }] };
const good = () => ({ model: TYPESAFE_MODEL, answers: { c0: { type: "noul", noul: 0.9 } }, usage: { input_tokens: 100, output_tokens: 10 } });
test("direct Jev uses pinned fixed endpoint, no routing or secrets in payload, price-table cost", async () => {
  const client = createTypeSafeDecisionsClient({ apiKey: "SENTINEL", model: TYPESAFE_MODEL, fetch: (async (url, opts) => {
    assert.equal(url, "https://api.typesafe.ai/v1/systemone"); assert.equal(opts!.redirect, "error");
    assert.equal((opts!.headers as any).authorization, "Bearer SENTINEL");
    const body = JSON.parse(String(opts!.body)); assert.equal(body.model, TYPESAFE_MODEL); assert.equal(body.provider, undefined);
    assert.match(body.questions.c0.instructions, /readFile/); assert.doesNotMatch(String(opts!.body), /SENTINEL/);
    return Response.json({ ...good(), usage: { ...good().usage, cost: 123 } });
  }) as typeof fetch });
  const result = await client.classify(req);
  // A provider-reported cost on the direct path is ignored; the price table is the source.
  assert.equal(result.costUsd, 100 * 0.042 / 1e6); assert.equal(result.costSource, "price-table");
  assert.equal(result.priceTable, PRICE_TABLE_VERSION);
});
test("malformed answers and parseable provider failure retain price-table cost", async () => {
  for (const failure of [false, true]) {
    const client = createTypeSafeDecisionsClient({ apiKey: "x", model: TYPESAFE_MODEL, fetch: (async () => Response.json({ ...good(), answers: {}, ...(failure ? { error: { message: "SENTINEL" } } : {}) }, { status: failure ? 500 : 200 })) as typeof fetch });
    const result = await client.classify(req); assert.equal(result.answers, null); assert.ok(result.costUsd! > 0);
    assert.equal(result.failure, failure ? "infra" : undefined); assert.doesNotMatch(JSON.stringify(result), /SENTINEL/);
  }
});
test("missing usage or mismatched observed model never produces a zero cost", async () => {
  for (const override of [{ usage: {} }, { model: "jev-latest" }, { usage: { input_tokens: -1, output_tokens: 1 } }]) {
    const result = await createTypeSafeDecisionsClient({ apiKey: "x", model: TYPESAFE_MODEL, fetch: (async () => Response.json({ ...good(), ...override })) as typeof fetch }).classify(req);
    assert.equal(result.costSource, undefined); assert.equal(result.costUsd, undefined);
  }
  assert.throws(() => createTypeSafeDecisionsClient({ apiKey: "x", model: "jev-latest" }), /Unsupported/);
});
test("direct cancellation, oversize and transport errors stay sanitized", async () => {
  let calls = 0;
  const client = createTypeSafeDecisionsClient({ apiKey: "SENTINEL", model: TYPESAFE_MODEL, fetch: (async () => { calls++; throw new Error("SENTINEL"); }) as typeof fetch });
  await assert.rejects(client.classify({ ...req, signal: AbortSignal.abort(new Error("SENTINEL")) }), e => !String(e).includes("SENTINEL"));
  assert.equal(calls, 0);
  await assert.rejects(client.classify(req), e => !String(e).includes("SENTINEL")); assert.equal(calls, 1);
  await assert.rejects(client.classify({ ...req, instruction: "x".repeat(20000) })); assert.equal(calls, 1);
});
