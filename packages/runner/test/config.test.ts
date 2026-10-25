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
  assert.equal(parseVariant("orchestrate[secondary=2,foo=bar]"), "orchestrate[foo=bar,secondary=2]");
  assert.equal(parseVariant("branch-only[z=1,a=2]"), "branch-only[a=2,z=1]");
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
  assert.deepEqual(expandModes("orchestrate[z=1,a=2]"), ["orchestrate[a=2,z=1]"]);
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
