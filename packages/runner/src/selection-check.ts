import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import {
  buildRegistry,
  classifierReranker,
  createSelector,
  isHardNegativeToolName,
  noneReranker,
  padRegistry,
  parseFrameworkVariant,
} from "@aiw/core";
import { createDecisionsClient, createTypeSafeDecisionsClient } from "@aiw/llm";
import type { DecisionsClient } from "@aiw/llm";
import { catalog, toHostDecl } from "@aiw/tools";
import type { Reporter } from "@aiw/telemetry";
import type { RunConfig } from "./types.ts";
import type { CostMeter } from "./cost-meter.ts";
import { createCostMeter } from "./cost-meter.ts";

/** One offline intent and its sufficient and prohibited tool sets. */
export interface SelectionCase {
  /** Unique identifier used in the report's failure list. */
  id: string;
  /** Planner-style description of one task step. */
  intent: string;
  /** Minimal sufficient tools that must appear in the final shortlist. */
  expected: string[];
  /** Tools that must not appear in the final shortlist. */
  forbidden?: string[];
}

/** Classifier settings captured in a report and compared by the run gate. */
export interface SelectionClassifierSettings {
  /** Provider used for classifier decisions. */
  provider: "openrouter-decisions" | "typesafe";
  /** Pinned classifier model name. */
  model: string;
  /** Minimum positive probability accepted by the classifier. */
  threshold: number;
  /** Classifier response policy. */
  policy: "noul-v1";
}

/** One case that missed an expected tool. */
export interface SelectionCheckFailure {
  /** Case identifier that missed at least one expected tool. */
  id: string;
  /** Final shortlist returned for this case. */
  shortlisted: string[];
}

/** Per-catalog selection measurements. */
export interface SelectionCheckResult {
  /** Number of tools in the padded catalog. */
  n: number;
  /** Fraction of cases whose expected tools all appeared in the shortlist. */
  recall: number;
  /** Average final shortlist length. */
  meanShortlistSize: number;
  /** 95th percentile final shortlist length. */
  p95ShortlistSize: number;
  /** Total hard-negative tools appearing across all case shortlists. */
  hardNegatives: number;
  /** Number of forbidden tools appearing in shortlists. */
  forbiddenHits: number;
  /** Cases whose expected set was incomplete, with their final shortlist. */
  failures: SelectionCheckFailure[];
  /** Cost of classifier decisions for this catalog size. */
  judgeCostUsd: number;
}

/** Provenance and measurements from an offline selection-check run. */
export interface SelectionCheckReport {
  /** Selection-report schema version. */
  format: 1;
  /** SHA-256 of the sorted, unpadded tier-L tool declarations. */
  catalogHash: string;
  /** SHA-256 of the cases file bytes. */
  casesHash: string;
  /** Rerank treatment evaluated by the report. */
  rerank: "none" | "classifier";
  /** Classifier settings, present only when rerank is classifier. */
  classifier?: SelectionClassifierSettings;
  /** Measurements for each requested padded-catalog size. */
  results: SelectionCheckResult[];
}

/** Hashes input bytes with SHA-256. */
function sha256(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Computes the stable hash of the unpadded tier-L declarations. */
export function tierLCatalogHash(root: string): string {
  const registry = buildRegistry(catalog("L", { root }).map(toHostDecl), { warn: () => {} });
  const declarations = registry.decls.map((decl) => ({ ...decl })).sort((a, b) => a.name.localeCompare(b.name));
  return sha256(JSON.stringify(declarations));
}

/** Validates case ids and tool references against the supplied catalog. */
export function validateSelectionCases(cases: SelectionCase[], names: Set<string> | Map<string, unknown>): void {
  const ids = new Set<string>();
  for (const item of cases) {
    if (!item.id || ids.has(item.id)) throw new Error(`Duplicate or empty selection case id: ${item.id}`);
    ids.add(item.id);
    if (!item.intent.trim() || !item.expected.length) throw new Error(`Case ${item.id} needs intent and expected tools`);
    for (const name of [...item.expected, ...(item.forbidden ?? [])]) {
      if (!names.has(name)) throw new Error(`Case ${item.id} references unknown tool ${name}`);
    }
  }
}

/** Runs the offline selection suite and writes its provenance report. */
export async function runSelectionCheck(opts: {
  root: string;
  casesPath?: string;
  catalogs?: number[];
  rerank?: "none" | "classifier";
  name?: string;
  classifier?: SelectionClassifierSettings;
  budgetUsd?: number;
}): Promise<SelectionCheckReport> {
  const root = opts.root;
  const casesPath = opts.casesPath ?? join(root, "experiments/selection/cases.json");
  const raw = readFileSync(casesPath);
  const cases = JSON.parse(raw.toString("utf8")) as SelectionCase[];
  const registry = buildRegistry(catalog("L", { root }).map(toHostDecl), { warn: () => {} });
  validateSelectionCases(cases, registry.byName);
  const catalogSizes = opts.catalogs ?? [50, 200, 1000];
  const mode = opts.rerank ?? "none";
  const classifier = mode === "classifier" ? opts.classifier : undefined;
  if (mode === "classifier" && !classifier) {
    throw new Error("Classifier mode requires classifier provider, model, threshold and policy settings");
  }
  if (mode === "none" && opts.classifier) throw new Error("Classifier settings require --rerank classifier");

  let meter: CostMeter | undefined;
  let classifierClient: DecisionsClient | undefined;
  if (classifier) {
    const apiKey = classifier.provider === "typesafe"
      ? process.env["TYPESAFE_API_KEY"]
      : process.env["OPENAI_API_KEY"] ?? process.env["OPENROUTER_API_KEY"];
    if (!apiKey) {
      const variable = classifier.provider === "typesafe" ? "TYPESAFE_API_KEY" : "OPENROUTER_API_KEY or OPENAI_API_KEY";
      throw new Error(`Classifier API key is missing; set ${variable} before running selection check`);
    }
    meter = createCostMeter(opts.budgetUsd ?? 0.5);
    const baseClient = classifier.provider === "typesafe"
      ? createTypeSafeDecisionsClient({ apiKey, model: classifier.model })
      : createDecisionsClient({ apiKey, model: classifier.model });
    classifierClient = meter.classifier(baseClient);
  }

  const report: SelectionCheckReport = {
    format: 1,
    catalogHash: tierLCatalogHash(root),
    casesHash: sha256(raw),
    rerank: mode,
    ...(classifier ? { classifier } : {}),
    results: [],
  };
  for (const n of catalogSizes) {
    const padded = padRegistry(registry, n);
    const costBefore = meter?.snapshot().knownCostUsd ?? 0;
    let recalled = 0;
    let totalSize = 0;
    let hardNegatives = 0;
    let forbiddenHits = 0;
    const sizes: number[] = [];
    const failures: SelectionCheckResult["failures"] = [];
    for (const item of cases) {
      const reporter = makeSelectionReporter();
      const reranker = classifier
        ? classifierReranker(classifierClient!, { model: classifier.model, threshold: classifier.threshold, policy: classifier.policy })
        : noneReranker;
      const selection = await createSelector({ reranker }).select(
        { instruction: item.intent, reporter },
        padded.decls,
      );
      const shortlisted = selection.tools.map((tool) => tool.name);
      if (item.expected.every((name) => shortlisted.includes(name))) recalled++;
      else failures.push({ id: item.id, shortlisted });
      totalSize += shortlisted.length;
      sizes.push(shortlisted.length);
      hardNegatives += shortlisted.filter(isHardNegativeToolName).length;
      forbiddenHits += (item.forbidden ?? []).filter((name) => shortlisted.includes(name)).length;
    }
    sizes.sort((a, b) => a - b);
    report.results.push({
      n,
      recall: cases.length ? recalled / cases.length : 0,
      meanShortlistSize: cases.length ? totalSize / cases.length : 0,
      p95ShortlistSize: sizes.length ? sizes[Math.ceil(sizes.length * 0.95) - 1]! : 0,
      hardNegatives,
      forbiddenHits,
      failures,
      judgeCostUsd: (meter?.snapshot().knownCostUsd ?? 0) - costBefore,
    });
  }
  const reportName = opts.name ?? mode;
  const out = join(root, "experiments/reports/selection", `${reportName}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.log("N | Recall | Mean shortlist | p95 | Hard negatives | Forbidden | Judge cost");
  for (const row of report.results) {
    const recall = (row.recall * 100).toFixed(1);
    const meanSize = row.meanShortlistSize.toFixed(2);
    const cost = row.judgeCostUsd.toFixed(6);
    console.log(`${row.n} | ${recall}% | ${meanSize} | ${row.p95ShortlistSize} | ${row.hardNegatives} | ${row.forbiddenHits} | $${cost}`);
  }
  return report;
}

/** Minimal in-memory reporter used to receive classifier telemetry without writing events. */
function makeSelectionReporter(): Reporter {
  let id = 0;
  return {
    scope: null,
    newId: () => `selection:${++id}`,
    turn: () => `selection:${++id}`,
    tool: () => `selection:${++id}`,
    toolStart: () => {},
    child: () => makeSelectionReporter(),
    attach: () => {},
  };
}

/** Checks one selection report against a requested rerank mode and catalog. */
export function assertSelectionGate(opts: {
  report?: SelectionCheckReport;
  catalogHash: string;
  rerank: "none" | "classifier";
  classifier?: SelectionClassifierSettings;
}): void {
  const report = opts.report;
  if (!report) throw new Error(`Selection check required; run \`aiw selection check --rerank ${opts.rerank}\``);
  if (report.catalogHash !== opts.catalogHash) {
    throw new Error(`Selection-check report has a stale catalog hash; run \`aiw selection check --rerank ${opts.rerank}\` again`);
  }
  if (report.rerank !== opts.rerank || JSON.stringify(report.classifier ?? null) !== JSON.stringify(opts.classifier ?? null)) {
    throw new Error(`Selection-check mode or judge settings do not match; run \`aiw selection check --rerank ${opts.rerank}\` with matching settings`);
  }
  if (!report.results.length || report.results.some((row) => row.recall < 0.9)) {
    throw new Error(`Selection-check recall is below 90%; fix selection metadata and run \`aiw selection check --rerank ${opts.rerank}\` again`);
  }
}

/** Enforces selection-report readiness independently for each orchestrate variant in a run. */
export function assertRunSelectionGate(opts: {
  kind: RunConfig["kind"];
  frameworks: string[];
  catalogHash: string;
  reports: SelectionCheckReport[];
  classifier?: SelectionClassifierSettings;
  warn?: (message: string) => void;
}): void {
  if (opts.kind === "dev") return;
  let needsLLMWarning = false;
  for (const framework of opts.frameworks) {
    const parsed = parseFrameworkVariant(framework);
    if (parsed.kind !== "orchestrate") continue;
    const variantRerank = parsed.variant.rerank ?? "llm";
    const checkRerank = variantRerank === "classifier" ? "classifier" : "none";
    const classifier = checkRerank === "classifier" ? opts.classifier : undefined;
    if (checkRerank === "classifier" && !classifier) {
      throw new Error("Classifier run settings are missing; cannot validate the selection-check report");
    }
    let firstError: unknown;
    let accepted = false;
    for (const report of opts.reports) {
      try {
        assertSelectionGate({ report, catalogHash: opts.catalogHash, rerank: checkRerank, ...(classifier ? { classifier } : {}) });
        accepted = true;
        break;
      } catch (error) {
        firstError ??= error;
      }
    }
    if (!accepted) {
      if (firstError) throw firstError;
      assertSelectionGate({ catalogHash: opts.catalogHash, rerank: checkRerank, ...(classifier ? { classifier } : {}) });
    }
    if (variantRerank === "llm") needsLLMWarning = true;
  }
  if (needsLLMWarning) {
    (opts.warn ?? console.warn)("Warning: the offline selection check covers retrieval only; the LLM rerank judge itself is not covered.");
  }
}

/** Loads every JSON selection report so custom report names can satisfy the start gate. */
export function loadSelectionReports(root: string): SelectionCheckReport[] {
  const directory = resolve(root, "experiments/reports/selection");
  if (!existsSync(directory)) return [];
  return readdirSync(directory)
    .filter((name) => name.endsWith(".json"))
    .map((name) => JSON.parse(readFileSync(join(directory, name), "utf8")) as SelectionCheckReport);
}
