import { test } from "node:test";
import assert from "node:assert/strict";
import { createCostMeter } from "../src/cost-meter.ts";

const req = { model: "m", system: "s".repeat(100), tools: [], messages: [] };
const costed = (costUsd: number) => ({ response: {}, usage: { input: 1, output: 1 }, costUsd, costSource: "price-table" as const, priceTable: "t" });

/** A client whose responses resolve only when the test releases them. */
function heldClient(costUsd: number) {
  const pending: ((cost: number) => void)[] = [];
  let sent = 0;
  return {
    get sent() { return sent; },
    /** Lets admitted requests reach the client, then resolves the oldest held response. */
    async release(cost = costUsd) { await new Promise((r) => setImmediate(r)); pending.shift()?.(cost); },
    client: { complete: () => { sent++; return new Promise<any>((resolve) => pending.push((cost) => resolve(costed(cost)))); } },
  };
}

test("parallel requests reserve their estimate, so in-flight responses cannot push spend past the budget", async () => {
  const held = heldClient(0.1);
  const meter = createCostMeter(0.35);
  const llm = meter.llm(held.client);
  const first = llm.complete(req); await held.release(); await first; // learns 0.1 per request of this size
  const inFlight = [llm.complete(req), llm.complete(req), llm.complete(req)];
  await new Promise((r) => setImmediate(r));
  assert.equal(held.sent, 3); // 0.1 known + 0.2 reserved; the third waits (0.1 + 0.3 >= 0.35)
  const thirdRefused = assert.rejects(inFlight[2]!, /budget/); // nothing in flight and 0.3 + 0.1 >= 0.35: closed
  await held.release(); await held.release();
  await new Promise((r) => setImmediate(r));
  assert.equal(held.sent, 3);
  await thirdRefused;
  await Promise.all(inFlight.slice(0, 2));
  assert.equal(meter.snapshot().knownCostUsd.toFixed(2), "0.30");
  assert.equal(meter.stopReason(), "budget");
});

test("a waiting request is admitted once a cheaper-than-estimated response frees budget", async () => {
  const held = heldClient(0.1);
  const meter = createCostMeter(0.35);
  const llm = meter.llm(held.client);
  const first = llm.complete(req); await held.release(); await first;
  const a = llm.complete(req), b = llm.complete(req), c = llm.complete(req);
  await new Promise((r) => setImmediate(r));
  assert.equal(held.sent, 3); // 0.1 known + 0.2 reserved: c waits (0.4 >= 0.35)
  await held.release(0.01); await a; // 0.11 known + 0.1 reserved + 0.1 < 0.35: c is admitted
  await new Promise((r) => setImmediate(r));
  assert.equal(held.sent, 4);
  await held.release(); await held.release(); await Promise.all([b, c]);
  assert.equal(meter.snapshot().knownCostUsd.toFixed(2), "0.31");
});

test("a waiting request whose signal aborts is cancelled without being sent", async () => {
  const held = heldClient(0.1);
  const meter = createCostMeter(0.25);
  const llm = meter.llm(held.client);
  const first = llm.complete(req); await held.release(); await first;
  const running = llm.complete(req);
  const controller = new AbortController();
  const waiting = llm.complete({ ...req, signal: controller.signal });
  await new Promise((r) => setImmediate(r));
  controller.abort();
  await held.release(); await running;
  await assert.rejects(waiting, /budget|cancelled/);
  assert.equal(held.sent, 2);
});
