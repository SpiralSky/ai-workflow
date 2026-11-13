import test from "node:test";
import assert from "node:assert/strict";
import { wilsonCI95, mdd, signTest } from "../src/combine.ts";

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

// --- Provenance validation through the public report command ---

import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { combineRuns } from "../src/combine.ts";
import type { RunJSON } from "../src/types.ts";

/** Creates a complete, deterministic synthetic run without invoking a model. */
function fixtureRun(id: string): RunJSON {
  return {
    format: 1, id, status: "complete",
    config: {
      kind: "dev", problems: ["p1"], frameworks: ["baseline"], tier: "S", reps: 1,
      budgetUsd: 0.5, concurrency: 2, models: { main: "fixture", secondary: "fixture" },
      temperature: 0, secondaryCap: 4,
      branch: { context: "trace", timeoutMs: 120000, limits: { valueChars: 200, loopCollapse: 3, eventBudget: 60 } },
    },
    provenance: {
      commit: "commit-a", dirty: false, runnerVersion: "1", engine: "isolated-vm", basePrompt: "base-hash",
      frameworks: { baseline: { prompt: "prompt-hash", tools: "tools-hash", extra: { rerank: "rerank-hash" } } },
      images: { p1: "image-1", p2: "image-2" },
      problems: { p1: { taskHash: "task-1", turnLimit: 20, wallClockMs: 60000 } },
    },
    totals: { jobs: 0, attempts: 0, costUsd: 0, pass: 0, fail: 0 }, startedAt: "2026-10-31T00:00:00Z",
  };
}

/** Writes only temporary fixture files and removes them after each test. */
function fixtureDirs(t: { after: (fn: () => void) => void }, runs: RunJSON[]): { root: string; dirs: string[] } {
  const root = mkdtempSync(join(tmpdir(), "aiw-combine-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const dirs = runs.map((run, i) => {
    const dir = join(root, `run-${i}`);
    mkdirSync(dir);
    writeFileSync(join(dir, "run.json"), JSON.stringify(run));
    return dir;
  });
  return { root, dirs };
}

for (const field of ["commit", "runnerVersion", "engine", "basePrompt"] as const) {
  test(`combineRuns rejects mismatched provenance.${field} without creating a report`, async (t) => {
    const first = fixtureRun("a");
    const second = fixtureRun("b");
    second.provenance[field] = "different";
    const { root, dirs } = fixtureDirs(t, [first, second]);
    await assert.rejects(combineRuns(dirs, "result", root), new RegExp(`provenance\\.${field}`));
    assert.equal(existsSync(join(root, "experiments")), false);
  });
}

for (const field of ["prompt", "tools"] as const) {
  test(`combineRuns rejects differing framework ${field} fingerprint`, async (t) => {
    const second = fixtureRun("b");
    second.provenance.frameworks.baseline![field] = "changed";
    const { root, dirs } = fixtureDirs(t, [fixtureRun("a"), second]);
    await assert.rejects(combineRuns(dirs, "result", root), /provenance\.frameworks/);
  });
}

test("combineRuns rejects differing extra fingerprint and image digest", async (t) => {
  for (const kind of ["extra", "image"] as const) {
    const second = fixtureRun("b");
    if (kind === "extra") second.provenance.frameworks.baseline!.extra!.rerank = "changed";
    else second.provenance.images.p1 = "changed";
    const { root, dirs } = fixtureDirs(t, [fixtureRun("a"), second]);
    await assert.rejects(combineRuns(dirs, "result", root), /provenance\.(frameworks|images)/);
  }
});

for (const field of ["taskHash", "turnLimit", "wallClockMs"] as const) {
  test(`combineRuns rejects shared-problem ${field} mismatch across later runs`, async (t) => {
    const first = fixtureRun("a");
    first.provenance.problems = {};
    const second = fixtureRun("b");
    const third = fixtureRun("c");
    if (field === "taskHash") third.provenance.problems.p1![field] = "different";
    else third.provenance.problems.p1![field] += 1;
    const { root, dirs } = fixtureDirs(t, [first, second, third]);
    await assert.rejects(combineRuns(dirs, "result", root), /provenance\.problems\.p1/);
  });
}

test("combineRuns accepts reordered objects and differing allowed config; preserves problem union", async (t) => {
  const first = fixtureRun("a");
  const second = fixtureRun("b");
  second.config = { ...second.config, kind: "pilot", problems: ["p2"], reps: 3, budgetUsd: 1, concurrency: 1 };
  second.config.models = { secondary: "fixture", main: "fixture" };
  second.provenance.frameworks.baseline = { tools: "tools-hash", extra: { rerank: "rerank-hash" }, prompt: "prompt-hash" };
  second.provenance.problems = { p2: { taskHash: "task-2", turnLimit: 10, wallClockMs: 30000 } };
  const { root, dirs } = fixtureDirs(t, [first, second]);
  await combineRuns(dirs, "result", root);
  const report = JSON.parse(readFileSync(join(root, "experiments/reports/result/report.json"), "utf8"));
  assert.deepEqual(report.provenance.problems, { ...first.provenance.problems, ...second.provenance.problems });
});

test("combineRuns rejects missing provenance instead of treating two omissions as equal", async (t) => {
  const first = fixtureRun("a");
  delete (first.provenance as Partial<RunJSON["provenance"]>).runnerVersion;
  const { root, dirs } = fixtureDirs(t, [first]);
  await assert.rejects(combineRuns(dirs, "result", root), /provenance\.runnerVersion/);
});

test("combineRuns rejects unsupported and missing run format", async (t) => {
  for (const format of [2, undefined]) {
    const first = fixtureRun("a");
    (first as unknown as { format: number | undefined }).format = format;
    const { root, dirs } = fixtureDirs(t, [first]);
    await assert.rejects(combineRuns(dirs, "result", root), /Unsupported run format/);
  }
});

test("combineRuns preserves special problem identifiers as own data keys", async (t) => {
  const first = fixtureRun("a");
  first.provenance.problems = JSON.parse('{"__proto__":{"taskHash":"special","turnLimit":1,"wallClockMs":10},"constructor":{"taskHash":"other","turnLimit":2,"wallClockMs":20}}');
  const { root, dirs } = fixtureDirs(t, [first]);
  await combineRuns(dirs, "result", root);
  const report = JSON.parse(readFileSync(join(root, "experiments/reports/result/report.json"), "utf8"));
  assert.equal(Object.hasOwn(report.provenance.problems, "__proto__"), true);
  assert.deepEqual(report.provenance.problems, first.provenance.problems);
});

test("combineRuns rejects unsupported and missing job format", async (t) => {
  for (const format of [2, undefined]) {
    const { root, dirs } = fixtureDirs(t, [fixtureRun("a")]);
    const jobDir = join(dirs[0]!, "job");
    mkdirSync(jobDir);
    writeFileSync(join(jobDir, "job.json"), JSON.stringify({ format }));
    await assert.rejects(combineRuns(dirs, "result", root), /Unsupported job format/);
  }
});

test("combineRuns reports missing nested config/provenance explicitly", async (t) => {
  for (const field of ["config", "provenance"] as const) {
    const first = fixtureRun("a");
    delete (first as Partial<RunJSON>)[field];
    const { root, dirs } = fixtureDirs(t, [first]);
    await assert.rejects(combineRuns(dirs, "result", root), /missing or malformed config\/provenance/);
  }
});

test("report preserves unknown task costs instead of presenting zero or partial spend", async (t) => {
  const { root, dirs } = fixtureDirs(t, [fixtureRun("a")]);
  for (const [i, cost] of [1, null].entries()) {
    const jobDir = join(dirs[0]!, `job-${i}`); mkdirSync(jobDir);
    writeFileSync(join(jobDir, "job.json"), JSON.stringify({ format: 1, problem: "p1", framework: "baseline", rep: i,
      outcome: "pass", reason: null, attempts: [{ n: 0, final: true }], costUsdAllAttempts: cost, durationMs: 1 }));
  }
  await combineRuns(dirs, "result", root);
  const report = JSON.parse(readFileSync(join(root, "experiments/reports/result/report.json"), "utf8"));
  assert.equal(report.frameworks.baseline.meanCostUsd, null);
  assert.equal(report.frameworks.baseline.costPerSuccessUsd, null);
  assert.match(readFileSync(join(root, "experiments/reports/result/report.md"), "utf8"), /unknown/);
});

test("combineRuns rejects mismatched provider, admission limits and effective inference", async t => {
  for (const field of ["provider", "subscriptionLimits", "inference"] as const) {
    const first = fixtureRun("a"), second = fixtureRun("b");
    if (field === "provider") second.config.provider = "deepseek";
    if (field === "subscriptionLimits") second.config.subscriptionLimits = { maxCalls: 5, maxTokens: 100, maxDurationMs: 1000 };
    if (field === "inference") second.provenance.inference = { provider: "deepseek", mainModel: "fixture", secondaryModel: "fixture", temperature: null };
    const { root, dirs } = fixtureDirs(t, [first, second]);
    await assert.rejects(combineRuns(dirs, "result", root), /mismatched provider/);
  }
});

test("plan-usage runs are dev-only and never combined", async t => {
  const plan = fixtureRun("plan"); plan.config.provider = "chatgpt";
  const { root, dirs } = fixtureDirs(t, [plan]);
  await assert.rejects(combineRuns(dirs, "plan", root), /plan usage/);
});

test("legacy reports explicitly label provenance as unattested rather than verified", async (t) => {
  const { root, dirs } = fixtureDirs(t, [fixtureRun("legacy")]);
  await combineRuns(dirs, "legacy-label", root);
  const report = JSON.parse(readFileSync(join(root, "experiments/reports/legacy-label/report.json"), "utf8"));
  assert.equal(report.provenanceStatus, "legacy-unattested");
  assert.match(readFileSync(join(root, "experiments/reports/legacy-label/report.md"), "utf8"), /not a verified baseline/);
});

test("DeepSeek price-table runs report cost and cannot combine with other provider runs", async t => {
  const a = fixtureRun("deepseek");
  a.config.provider = "deepseek";
  const { root, dirs } = fixtureDirs(t, [a]);
  const job = join(dirs[0]!, "p1.baseline.0"); mkdirSync(job);
  writeFileSync(join(job, "job.json"), JSON.stringify({ format: 1, framework: "baseline", problem: "p1", rep: 0, outcome: "pass", reason: null, attempts: [], costUsdAllAttempts: 0.012, durationMs: 1 }));
  await combineRuns(dirs, "deepseek", root);
  const report = JSON.parse(readFileSync(join(root, "experiments/reports/deepseek/report.json"), "utf8"));
  assert.equal(report.frameworks.baseline.meanCostUsd, 0.012);
  const b = fixtureRun("measured"); const mixed = fixtureDirs(t, [a, b]);
  await assert.rejects(combineRuns(mixed.dirs, "mixed", mixed.root), /provider/);
});

test("direct TypeSafe classifier provider isolates reports", async t => {
  const a = fixtureRun("a"), b = fixtureRun("b");
  const classifier = { provider: "typesafe" as const, model: "jev-1.14.0", threshold: 0.8, policy: "noul-v1" as const };
  a.config.classifier = classifier;
  for (const changed of [{ ...classifier, provider: "openrouter-decisions" as const }, { ...classifier, threshold: 0.9 }]) {
    b.config.classifier = changed;
    const { root, dirs } = fixtureDirs(t, [a, b]); await assert.rejects(combineRuns(dirs, "mixed-classifier", root), /provider|limits/);
  }
});

// --- paired cost, cost per pass, spread and the failure gate ---

test("signTest: exact two-sided p-values", () => {
  assert.equal(signTest(0, 0), 1);
  assert.equal(signTest(3, 3), 1);
  assert.equal(signTest(5, 0), 0.0625);
  assert.equal(signTest(6, 0), 0.03125);
  assert.ok(Math.abs(signTest(9, 1) - 22 / 1024) < 1e-12);
});

/** Writes one fixture job per entry: [problem, framework, outcome, cost]. */
function writeJobs(dir: string, jobs: Array<[string, string, "pass" | "fail", number]>): void {
  jobs.forEach(([problem, framework, outcome, cost], i) => {
    const jobDir = join(dir, `job-${i}`); mkdirSync(jobDir);
    writeFileSync(join(jobDir, "job.json"), JSON.stringify({ format: 1, problem, framework, rep: i,
      outcome, reason: outcome === "pass" ? null : "checks", attempts: [{ n: 0, final: true }], costUsdAllAttempts: cost, durationMs: 1 }));
  });
}

test("cost is compared only on problems both frameworks passed, and failures count in cost per pass", async (t) => {
  const { root, dirs } = fixtureDirs(t, [fixtureRun("a")]);
  // b fails the expensive problem p3, so its mean cost over passes looks cheap although it is dearer on every shared problem.
  writeJobs(dirs[0]!, [
    ["p1", "a", "pass", 1], ["p2", "a", "pass", 1], ["p3", "a", "pass", 10],
    ["p1", "b", "pass", 2], ["p2", "b", "pass", 2], ["p3", "b", "fail", 4],
  ]);
  await combineRuns(dirs, "paired", root);
  const report = JSON.parse(readFileSync(join(root, "experiments/reports/paired/report.json"), "utf8"));
  assert.equal(report.frameworks.a.costPerSuccessUsd, 4);
  assert.equal(report.frameworks.b.costPerSuccessUsd, 2);
  assert.equal(report.frameworks.b.costPerPassUsd, 4, "the failed job's cost is charged to the passes");
  const cost = report.paired[0].cost;
  assert.deepEqual([cost.problems, cost.meanA, cost.meanB, cost.ratio, cost.aCheaper, cost.bCheaper], [2, 1, 2, 2, 2, 0]);
  assert.equal(cost.verdict, "inconclusive", "two problems cannot support a cost claim");
  assert.equal(report.frameworks.a.costSpread, null, "no repetitions, no spread");
});

test("report markdown lists failure reasons and flags unequal turn-limit failures", async (t) => {
  const { root, dirs } = fixtureDirs(t, [fixtureRun("turn-limits")]);
  writeJobs(dirs[0]!, [["p1", "alpha", "fail", 1], ["p2", "alpha", "fail", 1], ["p3", "alpha", "fail", 1], ["p4", "alpha", "fail", 1], ["p5", "alpha", "fail", 1], ["p1", "beta", "fail", 1]]);
  const { readFileSync } = await import("node:fs");
  const { join } = await import("node:path");
  const { writeFileSync } = await import("node:fs");
  for (const [index, reason] of ["checks", "turn-limit", "timeout", "patch-failed", "context-limit"] .entries()) {
    const file = join(dirs[0]!, `job-${index}`, "job.json");
    const job = JSON.parse(readFileSync(file, "utf8")); job.reason = reason; writeFileSync(file, JSON.stringify(job));
  }
  await combineRuns(dirs, "failures-visible", root);
  const markdown = readFileSync(join(root, "experiments/reports/failures-visible/report.md"), "utf8");
  assert.match(markdown, /## Failures/);
  assert.match(markdown, /\| alpha \| 1 \| 1 \| 1 \| 1 \| 1 \|/);
  assert.match(markdown, /Warning: alpha and beta have different turn-limit failure counts.*may come from the turn limit/);
});

test("cost spread needs repetitions; the gate needs enough dev jobs", async (t) => {
  const { root, dirs } = fixtureDirs(t, [fixtureRun("a")]);
  writeJobs(dirs[0]!, [["p1", "a", "pass", 1], ["p1", "a", "pass", 3], ["p1", "a", "fail", 2]]);
  await combineRuns(dirs, "few", root);
  const few = JSON.parse(readFileSync(join(root, "experiments/reports/few/report.json"), "utf8"));
  assert.equal(few.frameworks.a.costSpread, 0.5);
  assert.deepEqual(few.frameworks.a.gate, { insufficient: 3 });

  const many = fixtureDirs(t, [fixtureRun("b")]);
  writeJobs(many.dirs[0]!, [...Array.from({ length: 8 }, (): [string, string, "pass", number] => ["p1", "a", "pass", 1]),
    ["p2", "a", "fail", 1], ["p2", "a", "fail", 1],
    ...Array.from({ length: 10 }, (): [string, string, "pass", number] => ["p1", "b", "pass", 1])]);
  await combineRuns(many.dirs, "gate", many.root);
  const gate = JSON.parse(readFileSync(join(many.root, "experiments/reports/gate/report.json"), "utf8"));
  assert.deepEqual(gate.frameworks.a.gate, { flagged: ["p2"] });
  assert.equal(gate.frameworks.b.gate, "ok");

  const pilot = fixtureRun("c"); pilot.config.kind = "pilot";
  const reported = fixtureDirs(t, [pilot]);
  writeJobs(reported.dirs[0]!, [["p1", "a", "fail", 1]]);
  await combineRuns(reported.dirs, "pilot", reported.root);
  assert.equal(JSON.parse(readFileSync(join(reported.root, "experiments/reports/pilot/report.json"), "utf8")).frameworks.a.gate, "not-applicable");
});
