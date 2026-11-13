import test from "node:test";
import assert from "node:assert/strict";
import { PRICE_TABLE, PRICE_TABLE_VERSION, priceUsage, tableCost } from "../src/prices.ts";

test("priceUsage prices each token category per million", () => {
  // DeepSeek off-peak: 6 uncached, 4 cached-read, 2 output.
  assert.equal(priceUsage("deepseek-flash", { input: 10, output: 2, cachedRead: 4 }), (6 * 0.15 + 4 * 0.003 + 2 * 0.6) / 1e6);
  // TypeSafe: input at one rate whether cached or not, output free.
  assert.equal(priceUsage("jev-1.14.0", { input: 100, output: 10 }), 100 * 0.042 / 1e6);
  assert.equal(priceUsage("jev-1.14.0", { input: 100, output: 10, cachedRead: 40 }), (60 * 0.042 + 40 * 0.042) / 1e6);
});

test("priceUsage invents no price for unknown models or unpriceable counts", () => {
  for (const model of ["gpt-5", "deepseek-v4-flash", "toString", "__proto__"]) assert.equal(priceUsage(model, { input: 1, output: 1 }), undefined);
  assert.equal(priceUsage("deepseek-flash", { input: 1, output: 0, cachedRead: 2 }), undefined);
  assert.equal(priceUsage("deepseek-flash", { input: -1, output: 0 }), undefined);
  assert.equal(PRICE_TABLE["deepseek-flash"]!.cacheWrite, undefined);
  assert.equal(priceUsage("deepseek-flash", { input: 10, output: 0, cacheWrite: 5 }), undefined);
});

test("tableCost names its source and table version, or returns nothing", () => {
  assert.deepEqual(tableCost("jev-1.14.0", { input: 1e6, output: 0 }), { costUsd: 0.042, costSource: "price-table", priceTable: PRICE_TABLE_VERSION });
  assert.equal(tableCost("deepseek-flash", { input: 0, output: 1e6 }, "api-equivalent").costSource, "api-equivalent");
  assert.deepEqual(tableCost("gpt-5", { input: 1, output: 1 }), {});
});
