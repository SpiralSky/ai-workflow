/**
 * `aiw report` command: load run directories, validate provenance, aggregate results.
 * Runner architecture §8; data-formats §4.
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";
import type { RunJSON, JobJSON } from "./types.ts";
import { assertCompleteProvenance } from "./provenance.ts";
import { FORMAT_VERSION } from "./types.ts";

/** Fields that must match across combined runs (data-formats §1.1). */
const MUST_MATCH: Array<keyof RunJSON["config"]> = ["tier", "models", "temperature", "secondaryCap", "branch"];

/** All provenance except per-problem metadata must match (data-formats §1.1). */
const PROVENANCE_MUST_MATCH: Array<keyof RunJSON["provenance"]> = [
  "commit", "dirty", "runnerVersion", "engine", "basePrompt", "frameworks", "images",
];

/** Combined report format (data-formats §4). */
export interface CombinedReport {
  format: typeof FORMAT_VERSION;
  name: string;
  runs: string[];
  provenance: RunJSON["provenance"];
  provenanceStatus: "runtime-observed" | "legacy-unattested";
  frameworks: Record<string, FrameworkStats>;
  paired: PairedComparison[];
  audits: Record<string, { label: "setup" | "framework"; note: string }>;
}

/** Per-framework aggregated statistics. */
export interface FrameworkStats {
  jobs: number;
  pass: number;
  passRate: number;
  wilson95: [number, number];
  /** Mean cost of the passing jobs only. Biased towards frameworks that fail expensive problems; not the headline. */
  costPerSuccessUsd: number | null;
  /** Cost of every job (passed or failed) divided by the number of passes: what one success costs to obtain. */
  costPerPassUsd: number | null;
  meanCostUsd: number | null;
  /** Mean coefficient of variation of job cost across repetitions of one problem; null with fewer than 2 jobs per problem. */
  costSpread: number | null;
  turns: { main: number; secondary: number };
  toolCalls: { topLevel: number; leaf: number };
  failures: Record<string, number>;
  /** Failure gate (framework-runner §6.6): dev reports only. */
  gate: "ok" | "not-applicable" | { insufficient: number } | { flagged: string[] };
}

/** Cost comparison of two frameworks on the problems both passed (framework-runner §6.2). */
export interface PairedCost {
  /** Problems where both frameworks have at least one passing job with a known cost. */
  problems: number;
  meanA: number | null;
  meanB: number | null;
  /** meanB / meanA over those problems. */
  ratio: number | null;
  aCheaper: number;
  bCheaper: number;
  /** Two-sided exact sign test over the problems (ties dropped). */
  pValue: number;
  verdict: "a-cheaper" | "b-cheaper" | "inconclusive";
}

/** Paired comparison between two frameworks. */
export interface PairedComparison {
  a: string;
  b: string;
  mdd: number;
  verdict: "better" | "worse" | "inconclusive";
  cost: PairedCost;
  problems: Array<{ problem: string; jobsA: number; jobsB: number; passA: number; passB: number; costA: number | null; costB: number | null;
    passCostA: number | null; passCostB: number | null }>;
}

/**
 * Computes a 95% Wilson confidence interval for a proportion.
 * @param successes - number of successes
 * @param n - total trials
 * @returns [lower, upper] bounds, clamped to [0, 1]
 */
export function wilsonCI95(successes: number, n: number): [number, number] {
  if (n === 0) return [0, 1];
  const z = 1.96;
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const center = (p + z2 / (2 * n)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return [Math.max(0, center - margin), Math.min(1, center + margin)];
}

/**
 * Computes the minimum detectable difference (MDD) at 95% for two proportions.
 * Based on pooled standard error: z * sqrt(2 * p_pool * (1-p_pool) / n).
 * @param passA - passes for framework A
 * @param passB - passes for framework B
 * @param n - number of jobs per framework (must be equal)
 */
export function mdd(passA: number, passB: number, n: number): number {
  if (n === 0) return 1;
  const pPool = (passA + passB) / (2 * n);
  return 1.96 * Math.sqrt((2 * pPool * (1 - pPool)) / n);
}

/**
 * Two-sided exact sign test: the probability of a split at least this uneven if either side were equally likely.
 * @param a - count favouring one side
 * @param b - count favouring the other side (ties are left out by the caller)
 * @returns p-value in (0, 1]; 1 when there are no observations
 */
export function signTest(a: number, b: number): number {
  const n = a + b;
  if (n === 0) return 1;
  const k = Math.min(a, b);
  let tail = 0;
  let c = 1; // C(n, i)
  for (let i = 0; i <= k; i++) {
    tail += c;
    c = (c * (n - i)) / (i + 1);
  }
  return Math.min(1, (2 * tail) / 2 ** n);
}

/** Minimum jobs per framework before the failure gate gives a verdict (one failure must not decide it). */
export const GATE_MIN_JOBS = 10;
/** Failure-gate pass-rate threshold (framework-runner §6.6). */
export const GATE_THRESHOLD = 0.9;

/** Mean cost of the passing jobs, or null if there are none or a cost is unknown. */
function meanPassCost(jobs: JobJSON[]): number | null {
  const passed = jobs.filter((j) => j.outcome === "pass");
  const total = sumJobCosts(passed);
  return passed.length > 0 && total !== null ? total / passed.length : null;
}

/** Groups jobs by problem id. */
function byProblem(jobs: JobJSON[]): Map<string, JobJSON[]> {
  const out = new Map<string, JobJSON[]>();
  for (const job of jobs) {
    if (!out.has(job.problem)) out.set(job.problem, []);
    out.get(job.problem)!.push(job);
  }
  return out;
}

/**
 * Reads and parses a run.json file.
 * @param runDir - path to the run directory
 * @throws Error if file cannot be read or parsed
 */
function readRunJSON(runDir: string): RunJSON {
  const path = join(runDir, "run.json");
  const run = JSON.parse(readFileSync(path, "utf8")) as RunJSON;
  if (run?.format !== FORMAT_VERSION) {
    throw new Error(`Unsupported run format in ${path}: ${JSON.stringify(run?.format)}`);
  }
  if (!run.config || typeof run.config !== "object" || !run.provenance || typeof run.provenance !== "object") {
    throw new Error(`Run ${run.id} has missing or malformed config/provenance`);
  }
  return run;
}

/**
 * Reads all job.json files from a run directory.
 * @param runDir - path to the run directory
 */
function readJobs(runDir: string): JobJSON[] {
  const jobs: JobJSON[] = [];
  let entries: string[];
  try {
    entries = readdirSync(runDir);
  } catch {
    return jobs;
  }
  for (const entry of entries) {
    const jobPath = join(runDir, entry, "job.json");
    if (!existsSync(jobPath)) continue;
    let job: JobJSON;
    try {
      job = JSON.parse(readFileSync(jobPath, "utf8")) as JobJSON;
    } catch {
      // Preserve the existing behavior for malformed JSON; schema validation is separate.
      continue;
    }
    if (job?.format !== FORMAT_VERSION) {
      throw new Error(`Unsupported job format in ${jobPath}: ${JSON.stringify(job?.format)}`);
    }
    jobs.push(job);
  }
  return jobs;
}

/**
 * Checks that the "must match" provenance fields agree across all runs.
 * @param runs - parsed run records
 * @returns Common provenance with the union of compatible problem metadata
 * @throws Error if a required field is missing or disagrees
 */
function validateProvenance(runs: RunJSON[]): RunJSON["provenance"] {
  const first = runs[0]!;
  const problems: RunJSON["provenance"]["problems"] = Object.create(null);
  for (const run of runs) {
    if (run.provenance.integrity || first.provenance.integrity) {
      assertCompleteProvenance(run.provenance, run.config);
      if (!isDeepStrictEqual(run.provenance.integrity?.runtimePlatform, first.provenance.integrity?.runtimePlatform)) throw new Error(`Run ${run.id} has mismatched runtime platform`);
      for (const field of ["sourceHash", "bundleHash", "entryHash", "nodeVersion", "wallClockEnforced"] as const) {
        if (run.provenance.integrity?.[field] !== first.provenance.integrity?.[field]) throw new Error(`Run ${run.id} has mismatched provenance.integrity.${field}`);
      }
    }
    // Plan runs are dev-only: never combined or reported (framework-runner §6.5).
    if (run.config.provider === "chatgpt") throw new Error(`Run ${run.id} uses plan usage and cannot be combined`);
    if ((run.config.provider ?? "openrouter") !== (first.config.provider ?? "openrouter") ||
        !isDeepStrictEqual(run.config.subscriptionLimits, first.config.subscriptionLimits) ||
        !isDeepStrictEqual(run.config.classifier, first.config.classifier) ||
        !isDeepStrictEqual(run.provenance.inference, first.provenance.inference)) {
      throw new Error(`Run ${run.id} has mismatched provider, limits or inference settings`);
    }
    for (const field of MUST_MATCH) {
      if (run.config[field] === undefined || !isDeepStrictEqual(first.config[field], run.config[field])) {
        throw new Error(`Run ${run.id} has missing or mismatched config.${field}`);
      }
    }
    for (const field of PROVENANCE_MUST_MATCH) {
      if (run.provenance[field] === undefined || !isDeepStrictEqual(first.provenance[field], run.provenance[field])) {
        throw new Error(`Run ${run.id} has missing or mismatched provenance.${field}`);
      }
    }
    if (!run.provenance.problems) {
      throw new Error(`Run ${run.id} has missing provenance.problems`);
    }
    for (const [problem, metadata] of Object.entries(run.provenance.problems)) {
      if (Object.hasOwn(problems, problem) && !isDeepStrictEqual(problems[problem], metadata)) {
        throw new Error(`Run ${run.id} has mismatched provenance.problems.${problem}`);
      }
      problems[problem] = metadata;
    }
  }
  // Preserve the full problem union instead of silently retaining only the first run's subset.
  return { ...first.provenance, problems };
}

/** Returns null if any task's full cost is unknown; lower bounds are not billed totals. */
function sumJobCosts(jobs: JobJSON[]): number | null {
  if (jobs.some((j) => typeof j.costUsdAllAttempts !== "number" || !Number.isFinite(j.costUsdAllAttempts) || j.costUsdAllAttempts < 0)) return null;
  return jobs.reduce((sum, j) => sum + j.costUsdAllAttempts!, 0);
}

/**
 * Aggregates job records for one framework into FrameworkStats.
 * @param jobs - all jobs for this framework
 * @param gated - whether the failure gate applies (every combined run is a dev run)
 */
function aggregateFramework(jobs: JobJSON[], gated: boolean): FrameworkStats {
  const n = jobs.length;
  const passCount = jobs.filter((j) => j.outcome === "pass").length;
  const passRate = n > 0 ? passCount / n : 0;
  const wilson95 = wilsonCI95(passCount, n);

  const successJobs = jobs.filter((j) => j.outcome === "pass");
  const totalCost = sumJobCosts(jobs);
  const successCost = sumJobCosts(successJobs);
  const costPerSuccessUsd = successJobs.length > 0 && successCost !== null ? successCost / successJobs.length : null;
  const meanCostUsd = n > 0 && totalCost !== null ? totalCost / n : null;
  const costPerPassUsd = passCount > 0 && totalCost !== null ? totalCost / passCount : null;

  // Run-to-run spread: coefficient of variation of job cost within each problem that has repetitions.
  const cvs: number[] = [];
  for (const group of byProblem(jobs).values()) {
    const total = sumJobCosts(group);
    if (group.length < 2 || total === null || total === 0) continue;
    const mean = total / group.length;
    const variance = group.reduce((sum, j) => sum + (j.costUsdAllAttempts! - mean) ** 2, 0) / (group.length - 1);
    cvs.push(Math.sqrt(variance) / mean);
  }
  const costSpread = cvs.length ? cvs.reduce((a, b) => a + b, 0) / cvs.length : null;

  let gate: FrameworkStats["gate"] = "not-applicable";
  if (gated) {
    if (n < GATE_MIN_JOBS) gate = { insufficient: n };
    else if (passRate < GATE_THRESHOLD) gate = { flagged: [...new Set(jobs.filter((j) => j.outcome === "fail").map((j) => j.problem))].sort() };
    else gate = "ok";
  }

  const failures: Record<string, number> = {};
  for (const job of jobs.filter((j) => j.outcome === "fail")) {
    const r = job.reason ?? "unknown";
    failures[r] = (failures[r] ?? 0) + 1;
  }

  return {
    jobs: n,
    pass: passCount,
    passRate,
    wilson95,
    costPerSuccessUsd,
    costPerPassUsd,
    meanCostUsd,
    costSpread,
    turns: { main: 0, secondary: 0 }, // rollup data not yet implemented
    toolCalls: { topLevel: 0, leaf: 0 },
    failures,
    gate,
  };
}

/**
 * Computes paired comparisons for all (a, b) framework pairs.
 * @param frameworkJobs - map of framework → job list
 */
function computePaired(frameworkJobs: Map<string, JobJSON[]>): PairedComparison[] {
  const frameworks = [...frameworkJobs.keys()];
  const pairs: PairedComparison[] = [];

  for (let i = 0; i < frameworks.length; i++) {
    for (let j = i + 1; j < frameworks.length; j++) {
      const a = frameworks[i]!;
      const b = frameworks[j]!;
      const jobsA = frameworkJobs.get(a)!;
      const jobsB = frameworkJobs.get(b)!;

      const n = Math.min(jobsA.length, jobsB.length);
      const passA = jobsA.filter((jb) => jb.outcome === "pass").length;
      const passB = jobsB.filter((jb) => jb.outcome === "pass").length;
      const mddVal = mdd(passA, passB, n);
      const diff = n > 0 ? (passA - passB) / n : 0;
      let verdict: PairedComparison["verdict"] = "inconclusive";
      if (Math.abs(diff) > mddVal) {
        verdict = diff > 0 ? "better" : "worse";
      }

      // Per-problem breakdown
      const problemsA = byProblem(jobsA);
      const problemsB = byProblem(jobsB);
      const allProblems = new Set([...problemsA.keys(), ...problemsB.keys()]);
      const problemStats = [...allProblems].map((problem) => {
        const pA = problemsA.get(problem) ?? [];
        const pB = problemsB.get(problem) ?? [];
        return {
          problem,
          jobsA: pA.length,
          jobsB: pB.length,
          passA: pA.filter((jb) => jb.outcome === "pass").length,
          passB: pB.filter((jb) => jb.outcome === "pass").length,
          costA: sumJobCosts(pA),
          costB: sumJobCosts(pB),
          passCostA: meanPassCost(pA),
          passCostB: meanPassCost(pB),
        };
      });

      // Cost is compared only on problems both frameworks passed, so failing the expensive
      // problems cannot make a framework look cheaper (framework-runner §6.2).
      const both = problemStats.filter((p) => p.passCostA !== null && p.passCostB !== null);
      const mean = (xs: number[]) => (xs.length ? xs.reduce((x, y) => x + y, 0) / xs.length : null);
      const meanA = mean(both.map((p) => p.passCostA!));
      const meanB = mean(both.map((p) => p.passCostB!));
      const aCheaper = both.filter((p) => p.passCostA! < p.passCostB!).length;
      const bCheaper = both.filter((p) => p.passCostB! < p.passCostA!).length;
      const pValue = signTest(aCheaper, bCheaper);
      const cost: PairedCost = {
        problems: both.length,
        meanA,
        meanB,
        ratio: meanA !== null && meanB !== null && meanA > 0 ? meanB / meanA : null,
        aCheaper,
        bCheaper,
        pValue,
        verdict: pValue < 0.05 ? (aCheaper > bCheaper ? "a-cheaper" : "b-cheaper") : "inconclusive",
      };

      pairs.push({ a, b, mdd: mddVal, verdict, cost, problems: problemStats });
    }
  }

  return pairs;
}

/**
 * Generates a human-readable markdown summary of the combined report.
 * @param report - combined report
 */
function generateMarkdown(report: CombinedReport): string {
  const lines: string[] = [`# Report: ${report.name}`, ""];
  lines.push(`Runs: ${report.runs.join(", ")}`, "");
  lines.push(report.provenanceStatus === "runtime-observed" ? "Provenance: runtime observed (local metadata, not cryptographic attestation)." : "Provenance: legacy/unattested — not a verified baseline.", "");
  lines.push("## Frameworks", "");
  const usd = (v: number | null) => (v === null ? "unknown" : "$" + v.toFixed(4));
  const gateText = (g: FrameworkStats["gate"]) =>
    typeof g === "string" ? g : "insufficient" in g ? `too few jobs (${g.insufficient} < ${GATE_MIN_JOBS})` : `flagged: ${g.flagged.join(", ")}`;
  lines.push("| Framework | Jobs | Pass | Pass Rate | 95% CI | Mean Cost | Cost per Pass | Cost Spread | Gate |");
  lines.push("|-----------|------|------|-----------|--------|-----------|---------------|-------------|------|");
  for (const [fw, stats] of Object.entries(report.frameworks)) {
    const ci = `[${stats.wilson95[0].toFixed(2)}, ${stats.wilson95[1].toFixed(2)}]`;
    lines.push(
      `| ${fw} | ${stats.jobs} | ${stats.pass} | ${(stats.passRate * 100).toFixed(1)}% | ${ci} | ${usd(stats.meanCostUsd)} | ${usd(stats.costPerPassUsd)} | ${stats.costSpread === null ? "n/a" : (stats.costSpread * 100).toFixed(0) + "%"} | ${gateText(stats.gate)} |`,
    );
  }
  lines.push("");
  const reasons = ["checks", "turn-limit", "timeout", "patch-failed", "context-limit"] as const;
  lines.push("## Failures", "");
  lines.push(`| Framework | ${reasons.join(" | ")} |`);
  lines.push(`|---|${reasons.map(() => "---").join("|")}|`);
  for (const [fw, stats] of Object.entries(report.frameworks)) {
    lines.push(`| ${fw} | ${reasons.map((reason) => stats.failures[reason] ?? 0).join(" | ")} |`);
  }
  lines.push("");
  for (const p of report.paired) {
    const a = report.frameworks[p.a]?.failures["turn-limit"] ?? 0;
    const b = report.frameworks[p.b]?.failures["turn-limit"] ?? 0;
    if (a !== b) lines.push(`Warning: ${p.a} and ${p.b} have different turn-limit failure counts (${a} vs ${b}); the pass-rate difference may come from the turn limit.`);
  }
  if (report.paired.some((p) => (report.frameworks[p.a]?.failures["turn-limit"] ?? 0) !== (report.frameworks[p.b]?.failures["turn-limit"] ?? 0))) lines.push("");
  if (report.paired.length > 0) {
    lines.push("## Paired Comparisons", "");
    for (const p of report.paired) {
      lines.push(`**${p.a} vs ${p.b}**: pass rate ${p.verdict} (MDD ${(p.mdd * 100).toFixed(1)}%); ` +
        `cost on ${p.cost.problems} problems both passed: ${usd(p.cost.meanA)} vs ${usd(p.cost.meanB)}, ` +
        `${p.cost.aCheaper}/${p.cost.bCheaper} cheaper, sign test p=${p.cost.pValue.toFixed(3)}: ${p.cost.verdict}`, "");
    }
    lines.push("");
  }
  return lines.join("\n");
}

/**
 * Runs the `aiw report` command: loads run directories, validates provenance,
 * aggregates results, and writes report.json + report.md.
 * @param runDirs - paths to run directories to combine
 * @param name - report name
 * @param repoRoot - project root containing `experiments/`
 */
export async function combineRuns(runDirs: string[], name: string, repoRoot: string): Promise<void> {
  const parsedRuns = runDirs.map((dir) => ({ dir, run: readRunJSON(dir) }));

  // Reject invalid runs
  const validRuns = parsedRuns.filter(({ run }) => {
    if (typeof run.status !== "string" || run.status !== "complete") {
      console.error(`Skipping invalid or incomplete run: ${run.id} (status: ${JSON.stringify(run.status)})`);
      return false;
    }
    if (run.provenance.dirty) {
      console.error(`Skipping run with uncommitted changes: ${run.id}`);
      return false;
    }
    return true;
  });

  if (validRuns.length === 0) throw new Error("No valid runs to combine");

  const runJSONs = validRuns.map((r) => r.run);
  const provenance = validateProvenance(runJSONs);

  // Collect all jobs
  const frameworkJobs = new Map<string, JobJSON[]>();
  for (const { dir } of validRuns) {
    for (const job of readJobs(dir)) {
      if (!frameworkJobs.has(job.framework)) frameworkJobs.set(job.framework, []);
      frameworkJobs.get(job.framework)!.push(job);
    }
  }

  // The failure gate is for dev runs only; the reported set is never gated (problems §8.5).
  const gated = runJSONs.every((r) => r.config.kind === "dev");
  const frameworks: CombinedReport["frameworks"] = {};
  for (const [fw, jobs] of frameworkJobs) {
    frameworks[fw] = aggregateFramework(jobs, gated);
  }

  const report: CombinedReport = {
    format: FORMAT_VERSION,
    name,
    runs: runJSONs.map((r) => r.id),
    provenance,
    provenanceStatus: provenance.integrity ? "runtime-observed" : "legacy-unattested",
    frameworks,
    paired: computePaired(frameworkJobs),
    audits: {},
  };

  const outDir = join(repoRoot, "experiments", "reports", name);
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, "report.json"), JSON.stringify(report, null, 2) + "\n", "utf8");
  writeFileSync(join(outDir, "report.md"), generateMarkdown(report), "utf8");

  console.log(`Report written to ${outDir}`);
}
