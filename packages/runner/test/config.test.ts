import test from "node:test";
import assert from "node:assert/strict";
import { parseVariant, expandModes, validateModel, resolveConfig, COMPARE_MODES } from "../src/config.ts";

// --- parseVariant ---

test("parseVariant: bare mode name passes through", () => {
  assert.equal(parseVariant("baseline"), "baseline");
  assert.equal(parseVariant("branch-only"), "branch-only");
  assert.equal(parseVariant("orchestrate"), "orchestrate");
});

test("parseVariant: keys are sorted for canonical form", () => {
  assert.equal(parseVariant("orchestrate[secondary=2,rerank=none]"), "orchestrate[rerank=none,secondary=2]");
  assert.equal(parseVariant("branch-only[toolSearch,catalog=50]"), "branch-only[catalog=50,toolSearch]");
});

test("parseVariant: single key passes through unchanged", () => {
  assert.equal(parseVariant("orchestrate[secondary=2]"), "orchestrate[secondary=2]");
});

test("parseVariant: empty brackets removed", () => {
  assert.equal(parseVariant("baseline[]"), "baseline");
});

test("parseVariant: whitespace trimmed", () => {
  assert.equal(parseVariant("  baseline  "), "baseline");
});

// --- expandModes ---

test("expandModes: compare expands to all three modes", () => {
  const result = expandModes("compare");
  assert.deepEqual(result, [...COMPARE_MODES]);
});

test("expandModes: specific mode passes through", () => {
  assert.deepEqual(expandModes("baseline"), ["baseline"]);
});

test("expandModes: comma-separated modes", () => {
  assert.deepEqual(expandModes("baseline,branch-only"), ["baseline", "branch-only"]);
});

test("expandModes: deduplicates", () => {
  const result = expandModes("compare,baseline");
  // compare expands to baseline, branch-only, orchestrate; then baseline is a duplicate
  assert.deepEqual(result, ["baseline", "branch-only", "orchestrate"]);
});

test("expandModes: variant string is canonicalised", () => {
  assert.deepEqual(expandModes("orchestrate[secondary=2,catalog=50]"), ["orchestrate[catalog=50,secondary=2]"]);
});

// --- validateModel ---

test("validateModel: allows deepseek model", () => {
  assert.doesNotThrow(() => validateModel("deepseek/deepseek-v4-flash"));
});

test("validateModel: rejects anthropic/* models", () => {
  assert.throws(() => validateModel("anthropic/claude-3-5-sonnet"), /not allowed/);
  assert.throws(() => validateModel("Anthropic/claude-opus"), /not allowed/);
});

// --- resolveConfig ---

const sampleProblems = [
  { id: "01-chunk", size: "small", set: "reported" },
  { id: "02-dev", size: "smoke", set: "dev" },
];

test("resolveConfig: resolves kind=dev when all problems are dev/smoke", () => {
  const config = resolveConfig(
    {
      problems: "dev",
      mode: "baseline",
      tools: "S",
      reps: 1,
      model: "deepseek/deepseek-v4-flash",
      temperature: 0,
      budget: 0.5,
      full: false,
      concurrency: 2,
      branchContext: "trace",
      secondaryCap: 4,
    },
    sampleProblems,
  );
  assert.equal(config.kind, "dev");
});

test("resolveConfig: kind=pilot when reported problems included", () => {
  const config = resolveConfig(
    {
      problems: "all",
      mode: "baseline",
      tools: "S",
      reps: 1,
      model: "deepseek/deepseek-v4-flash",
      temperature: 0,
      budget: 0.5,
      full: false,
      concurrency: 2,
      branchContext: "trace",
      secondaryCap: 4,
    },
    sampleProblems,
  );
  assert.equal(config.kind, "pilot");
});

test("resolveConfig: --full sets kind=full", () => {
  const config = resolveConfig(
    {
      problems: "all",
      mode: "baseline",
      tools: "S",
      reps: 1,
      model: "deepseek/deepseek-v4-flash",
      temperature: 0,
      budget: 1.0,
      full: true,
      concurrency: 2,
      branchContext: "trace",
      secondaryCap: 4,
    },
    sampleProblems,
  );
  assert.equal(config.kind, "full");
});

test("resolveConfig: secondary defaults to main model", () => {
  const config = resolveConfig(
    {
      problems: "dev",
      mode: "baseline",
      tools: "L",
      reps: 2,
      model: "deepseek/deepseek-v4-flash",
      temperature: 0,
      budget: 0.5,
      full: false,
      concurrency: 2,
      branchContext: "trace",
      secondaryCap: 4,
    },
    sampleProblems,
  );
  assert.equal(config.models.secondary, "deepseek/deepseek-v4-flash");
});

test("resolveConfig: throws on anthropic model", () => {
  assert.throws(
    () =>
      resolveConfig(
        {
          problems: "dev",
          mode: "baseline",
          tools: "S",
          reps: 1,
          model: "anthropic/claude-3",
          temperature: 0,
          budget: 0.5,
          full: false,
          concurrency: 2,
          branchContext: "trace",
          secondaryCap: 4,
        },
        sampleProblems,
      ),
    /not allowed/,
  );
});

test("campaign concurrency defaults to one, accepts explicit parallelism and rejects invalid values", () => {
  const flags = { problems: "dev", mode: "baseline", tools: "S" as const, reps: 1,
    model: "deepseek/deepseek-v4-flash", temperature: 0, budget: 0.5, full: false,
    branchContext: "trace" as const, secondaryCap: 4 };
  assert.equal(resolveConfig(flags, sampleProblems).concurrency, 1);
  assert.equal(resolveConfig({ ...flags, concurrency: 3 }, sampleProblems).concurrency, 3);
  for (const concurrency of [0, -1, 1.5, NaN, Infinity]) {
    assert.throws(() => resolveConfig({ ...flags, concurrency }, sampleProblems), /positive integer/);
  }
});

test("hotPaths is a distinct canonical opt-in, never part of compare", () => {
  assert.equal(parseVariant("orchestrate[rerank=none,hotPaths]"), "orchestrate[hotPaths,rerank=none]");
  assert.deepEqual(expandModes("compare,orchestrate[hotPaths]"), ["baseline", "branch-only", "orchestrate", "orchestrate[hotPaths]"]);
  assert.deepEqual(expandModes("compare"), ["baseline", "branch-only", "orchestrate"]);
  assert.throws(() => parseVariant("baseline[hotPaths]"));
});
