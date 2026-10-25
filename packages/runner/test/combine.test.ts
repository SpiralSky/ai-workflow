import test from "node:test";
import assert from "node:assert/strict";
import { wilsonCI95, mdd } from "../src/combine.ts";

// --- wilsonCI95 ---

test("wilsonCI95: zero trials returns [0, 1]", () => {
  const [lo, hi] = wilsonCI95(0, 0);
  assert.equal(lo, 0);
  assert.equal(hi, 1);
});

test("wilsonCI95: all successes has upper bound 1", () => {
  const [lo, hi] = wilsonCI95(10, 10);
  assert.ok(lo > 0.7, `lower bound ${lo} should be > 0.7`);
  assert.equal(hi, 1);
});

test("wilsonCI95: no successes has lower bound 0", () => {
  const [lo, hi] = wilsonCI95(0, 10);
  assert.equal(lo, 0);
  assert.ok(hi < 0.3, `upper bound ${hi} should be < 0.3`);
});

test("wilsonCI95: 50% success produces symmetric interval around 0.5", () => {
  const [lo, hi] = wilsonCI95(5, 10);
  // Interval should be roughly [0.19, 0.81] for n=10, p=0.5
  assert.ok(lo < 0.5, `lower ${lo} should be < 0.5`);
  assert.ok(hi > 0.5, `upper ${hi} should be > 0.5`);
  assert.ok(Math.abs((lo + hi) / 2 - 0.5) < 0.1, "midpoint should be close to 0.5");
});

test("wilsonCI95: bounds are in [0, 1]", () => {
  for (const [s, n] of [[0, 5], [1, 5], [5, 5], [3, 10]]) {
    const [lo, hi] = wilsonCI95(s!, n!);
    assert.ok(lo >= 0 && lo <= 1, `lower ${lo} out of range`);
    assert.ok(hi >= 0 && hi <= 1, `upper ${hi} out of range`);
    assert.ok(lo <= hi, `lower ${lo} > upper ${hi}`);
  }
});

test("wilsonCI95: larger n produces narrower interval", () => {
  const [lo10, hi10] = wilsonCI95(5, 10);
  const [lo100, hi100] = wilsonCI95(50, 100);
  const width10 = hi10 - lo10;
  const width100 = hi100 - lo100;
  assert.ok(width100 < width10, `n=100 width ${width100} should be < n=10 width ${width10}`);
});

// --- mdd ---

test("mdd: zero trials returns 1 (maximally underpowered)", () => {
  assert.equal(mdd(0, 0, 0), 1);
});

test("mdd: larger n gives smaller MDD", () => {
  const mdd10 = mdd(5, 5, 10);
  const mdd100 = mdd(50, 50, 100);
  assert.ok(mdd100 < mdd10, `mdd(n=100)=${mdd100} should be < mdd(n=10)=${mdd10}`);
});

test("mdd: equal pass rates give symmetric pooled estimate", () => {
  const m = mdd(5, 5, 10);
  assert.ok(m > 0 && m <= 1, `mdd ${m} should be in (0,1]`);
});

test("mdd: 50/50 pool gives maximum variance (widest MDD at given n)", () => {
  const m50 = mdd(5, 5, 10);  // p_pool = 0.5
  const m80 = mdd(8, 8, 10);  // p_pool = 0.8 (lower variance)
  assert.ok(m50 > m80, `50/50 pool MDD ${m50} should be > 80/80 pool MDD ${m80}`);
});
