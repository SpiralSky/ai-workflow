import test from "node:test";
import assert from "node:assert/strict";
import { expandJobs, buildPlan } from "../src/plan.ts";
import type { RunConfig } from "../src/types.ts";

const BASE_CONFIG: RunConfig = {
  kind: "dev",
  problems: ["p1", "p2"],
  frameworks: ["baseline", "branch-only"],
  tier: "S",
  reps: 1,
  budgetUsd: 0.5,
  concurrency: 2,
  models: { main: "deepseek/deepseek-v4-flash", secondary: "deepseek/deepseek-v4-flash" },
  temperature: 0,
  secondaryCap: 4,
  branch: { context: "trace", timeoutMs: 120_000, limits: { valueChars: 200, loopCollapse: 3, eventBudget: 60 } },
};

// --- expandJobs ---

test("expandJobs: produces correct job count (problems × frameworks × reps)", () => {
  const jobs = expandJobs(BASE_CONFIG);
  assert.equal(jobs.length, 2 * 2 * 1); // 2 problems × 2 frameworks × 1 rep
});

test("expandJobs: with reps=2 produces doubled count", () => {
  const config = { ...BASE_CONFIG, reps: 2 };
  const jobs = expandJobs(config);
  assert.equal(jobs.length, 2 * 2 * 2);
});

test("expandJobs: interleaves frameworks per problem per rep (A-15)", () => {
  const jobs = expandJobs(BASE_CONFIG);
  // Expected order: rep0 → p1/baseline, p1/branch-only, p2/baseline, p2/branch-only
  assert.equal(jobs[0]!.problem, "p1");
  assert.equal(jobs[0]!.framework, "baseline");
  assert.equal(jobs[1]!.problem, "p1");
  assert.equal(jobs[1]!.framework, "branch-only");
  assert.equal(jobs[2]!.problem, "p2");
  assert.equal(jobs[2]!.framework, "baseline");
  assert.equal(jobs[3]!.problem, "p2");
  assert.equal(jobs[3]!.framework, "branch-only");
});

test("expandJobs: job has correct rep values", () => {
  const config = { ...BASE_CONFIG, reps: 2 };
  const jobs = expandJobs(config);
  const rep0 = jobs.filter((j) => j.rep === 0);
  const rep1 = jobs.filter((j) => j.rep === 1);
  assert.equal(rep0.length, 4);
  assert.equal(rep1.length, 4);
});

test("expandJobs: single problem single framework", () => {
  const config = { ...BASE_CONFIG, problems: ["only"], frameworks: ["baseline"] };
  const jobs = expandJobs(config);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0]!.problem, "only");
  assert.equal(jobs[0]!.framework, "baseline");
  assert.equal(jobs[0]!.rep, 0);
});

// --- buildPlan ---

test("buildPlan: no history → jobs returned with no projectedCostUsd", () => {
  // Use a temp dir with no experiments/ to ensure no history
  const plan = buildPlan(BASE_CONFIG, "/nonexistent/path");
  assert.equal(plan.projectedCostUsd, undefined);
  assert.equal(plan.jobs.length, 4);
});
