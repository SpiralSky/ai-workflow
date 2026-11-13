import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { catalog } from "@aiw/tools";
import { isHardNegativeToolName } from "@aiw/core";
import { assertRunSelectionGate, runSelectionCheck, validateSelectionCases, type SelectionCheckReport, type SelectionCase } from "../src/selection-check.ts";

const repoRoot = fileURLToPath(new URL("../../..", import.meta.url));

test("shipped cases are valid, unique, and cover every tier-L tool group", () => {
  const names = new Set(catalog("L", { root: repoRoot }).map((tool) => tool.name));
  const cases = JSON.parse(readFileSync(join(repoRoot, "experiments/selection/cases.json"), "utf8")) as SelectionCase[];
  validateSelectionCases(cases, names);
  assert.equal(cases.length, 44);
  const expected = new Set(cases.flatMap((item) => item.expected));
  const covered = new Set<string>(["S"]);
  for (const name of expected) {
    if (["multiEdit", "moveFile", "deleteFile", "listDir"].includes(name)) covered.add("fs");
    else if (["outline", "readSymbol", "findDefinition", "findReferences", "signature"].includes(name)) covered.add("nav");
    else if (["overview", "callGraph", "importGraph", "impact", "dataFlow"].includes(name)) covered.add("graph");
    else if (["renameSymbol", "moveSymbol", "moveModule", "extractFunction", "inlineSymbol",
      "changeSignature", "extractVariable", "organizeImports", "replaceSymbol"].includes(name)) covered.add("refactor");
    else if (["runTests", "listTests", "coverage", "runSnippet", "traceCalls", "stressRun"].includes(name)) covered.add("test");
    else if (["check", "format"].includes(name)) covered.add("check");
    else if (["diff", "history", "restore"].includes(name)) covered.add("vcs");
    else if (["issues", "pullRequests", "ciStatus", "httpRequest", "fetchUrl", "webSearch", "sqlQuery",
      "packageInfo", "installPackage", "docsSearch", "notify", "containerLogs", "metrics", "featureFlags"].includes(name)) covered.add("external");
  }
  assert.deepEqual([...covered].sort(), ["S", "check", "external", "fs", "graph", "nav", "refactor", "test", "vcs"].sort());
});

test("none rerank produces deterministic recall and counts hard negatives", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "aiw-selection-")); t.after(() => rmSync(root, { recursive: true, force: true }));
  const cases: SelectionCase[] = [
    { id: "one", intent: "Find the definition of parseToken.", expected: ["findDefinition"] },
    { id: "two", intent: "Change the parameter list of a function.", expected: ["changeSignature"] },
  ];
  const path = join(root, "cases.json"); writeFileSync(path, JSON.stringify(cases));
  const result = await runSelectionCheck({ root, casesPath: path, catalogs: [50], name: "deterministic" });
  assert.equal(result.results[0]!.recall, 1);
  assert.ok(result.results[0]!.hardNegatives >= 0);
  assert.equal(isHardNegativeToolName("listPullRequest"), true);
  assert.equal(isHardNegativeToolName("readFile"), false);
});

test("selection gate checks each rerank variant and covers refusals", () => {
  const report: SelectionCheckReport = {
    format: 1,
    catalogHash: "hash",
    casesHash: "cases",
    rerank: "none",
    results: [{ n: 50, recall: 0.9, meanShortlistSize: 2, p95ShortlistSize: 3,
      hardNegatives: 0, forbiddenHits: 0, failures: [], judgeCostUsd: 0 }],
  };
  const base = { kind: "pilot" as const, frameworks: ["orchestrate[rerank=none]"], catalogHash: "hash", reports: [report] };
  assert.doesNotThrow(() => assertRunSelectionGate(base));
  const classifier = { provider: "typesafe" as const, model: "jev-1.14.0", threshold: 0.8, policy: "noul-v1" as const };
  const classifierReport: SelectionCheckReport = { ...report, rerank: "classifier", classifier };
  assert.doesNotThrow(() => assertRunSelectionGate({ ...base, frameworks: ["orchestrate[rerank=classifier]"], reports: [classifierReport], classifier }));
  assert.throws(() => assertRunSelectionGate({ ...base, frameworks: ["orchestrate[rerank=classifier]"], reports: [classifierReport] }), /settings are missing/);
  assert.throws(() => assertRunSelectionGate({ ...base, frameworks: ["orchestrate[rerank=classifier]"],
    reports: [classifierReport], classifier: { ...classifier, provider: "openrouter-decisions" } }), /judge settings/);
  assert.throws(() => assertRunSelectionGate({ ...base, frameworks: ["orchestrate[rerank=classifier]"],
    reports: [classifierReport], classifier: { ...classifier, threshold: 0.9 } }), /judge settings/);

  const warnings: string[] = [];
  assert.doesNotThrow(() => assertRunSelectionGate({ ...base, frameworks: ["orchestrate"], warn: (message) => warnings.push(message) }));
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /LLM rerank judge itself is not covered/);
  assert.doesNotThrow(() => assertRunSelectionGate({ ...base, kind: "dev", reports: [] }));
  assert.throws(() => assertRunSelectionGate({ ...base, reports: [] }), /aiw selection check --rerank none/);
  assert.throws(() => assertRunSelectionGate({ ...base, catalogHash: "stale" }), /stale catalog/);
  assert.throws(() => assertRunSelectionGate({ ...base, reports: [{ ...report, results: [{ ...report.results[0]!, recall: 0.89 }] }] }), /below 90%/);
  assert.throws(() => assertRunSelectionGate({ ...base,
    frameworks: ["orchestrate[rerank=none]", "orchestrate[rerank=classifier]"], reports: [report], classifier }),
  /aiw selection check --rerank classifier/);
});
