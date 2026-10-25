/**
 * `aiw report` command: load run directories, validate provenance, aggregate results.
 * Runner architecture §8; data-formats §4.
 */

import { readFileSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { RunJSON, JobJSON } from "./types.ts";
import { FORMAT_VERSION } from "./types.ts";

/** Fields that must match across combined runs (data-formats §1.1). */
const MUST_MATCH: Array<keyof RunJSON["config"]> = ["tier", "models", "temperature", "secondaryCap", "branch"];

/** Combined report format (data-formats §4). */
export interface CombinedReport {
  format: typeof FORMAT_VERSION;
  name: string;
  runs: string[];
  provenance: RunJSON["provenance"];
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
  costPerSuccessUsd: number;
  meanCostUsd: number;
  turns: { main: number; secondary: number };
  toolCalls: { topLevel: number; leaf: number };
  failures: Record<string, number>;
  gate: "ok" | { flagged: string[] };
}

/** Paired comparison between two frameworks. */
export interface PairedComparison {
  a: string;
  b: string;
  mdd: number;
  verdict: "better" | "worse" | "inconclusive";
  problems: Array<{ problem: string; passA: number; passB: number; costA: number; costB: number }>;
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
 * Reads and parses a run.json file.
 * @param runDir - path to the run directory
 * @throws Error if file cannot be read or parsed
 */
function readRunJSON(runDir: string): RunJSON {
  const path = join(runDir, "run.json");
  return JSON.parse(readFileSync(path, "utf8")) as RunJSON;
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
    try {
      jobs.push(JSON.parse(readFileSync(jobPath, "utf8")) as JobJSON);
    } catch {
      // Skip malformed records
    }
  }
  return jobs;
}

/**
 * Checks that the "must match" provenance fields agree across all runs.
 * @param runs - parsed run records
 * @throws Error if any field disagrees
 */
function validateProvenance(runs: RunJSON[]): void {
  if (runs.length === 0) return;
  const first = runs[0]!;
  for (const run of runs.slice(1)) {
    for (const field of MUST_MATCH) {
      const a = JSON.stringify(first.config[field]);
      const b = JSON.stringify(run.config[field]);
      if (a !== b) {
        throw new Error(`Run ${run.id} has mismatched config.${field}: expected ${a}, got ${b}`);
      }
    }
  }
}

/**
 * Aggregates job records for one framework into FrameworkStats.
 * @param jobs - all jobs for this framework
 */
function aggregateFramework(jobs: JobJSON[]): FrameworkStats {
  const n = jobs.length;
  const passCount = jobs.filter((j) => j.outcome === "pass").length;
  const passRate = n > 0 ? passCount / n : 0;
  const wilson95 = wilsonCI95(passCount, n);

  const successJobs = jobs.filter((j) => j.outcome === "pass");
  const totalCost = jobs.reduce((sum, j) => sum + (j.costUsdAllAttempts ?? 0), 0);
  const costPerSuccessUsd = successJobs.length > 0
    ? successJobs.reduce((sum, j) => sum + (j.costUsdAllAttempts ?? 0), 0) / successJobs.length
    : 0;
  const meanCostUsd = n > 0 ? totalCost / n : 0;

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
    meanCostUsd,
    turns: { main: 0, secondary: 0 }, // rollup data not yet implemented
    toolCalls: { topLevel: 0, leaf: 0 },
    failures,
    gate: "ok",
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
      const problemsA = new Map<string, JobJSON[]>();
      const problemsB = new Map<string, JobJSON[]>();
      for (const jb of jobsA) {
        if (!problemsA.has(jb.problem)) problemsA.set(jb.problem, []);
        problemsA.get(jb.problem)!.push(jb);
      }
      for (const jb of jobsB) {
        if (!problemsB.has(jb.problem)) problemsB.set(jb.problem, []);
        problemsB.get(jb.problem)!.push(jb);
      }
      const allProblems = new Set([...problemsA.keys(), ...problemsB.keys()]);
      const problemStats = [...allProblems].map((problem) => {
        const pA = problemsA.get(problem) ?? [];
        const pB = problemsB.get(problem) ?? [];
        return {
          problem,
          passA: pA.filter((jb) => jb.outcome === "pass").length,
          passB: pB.filter((jb) => jb.outcome === "pass").length,
          costA: pA.reduce((sum, jb) => sum + (jb.costUsdAllAttempts ?? 0), 0),
          costB: pB.reduce((sum, jb) => sum + (jb.costUsdAllAttempts ?? 0), 0),
        };
      });

      pairs.push({ a, b, mdd: mddVal, verdict, problems: problemStats });
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
  lines.push("## Frameworks", "");
  lines.push("| Framework | Jobs | Pass | Pass Rate | 95% CI | Mean Cost |");
  lines.push("|-----------|------|------|-----------|--------|-----------|");
  for (const [fw, stats] of Object.entries(report.frameworks)) {
    const ci = `[${stats.wilson95[0].toFixed(2)}, ${stats.wilson95[1].toFixed(2)}]`;
    lines.push(
      `| ${fw} | ${stats.jobs} | ${stats.pass} | ${(stats.passRate * 100).toFixed(1)}% | ${ci} | $${stats.meanCostUsd.toFixed(4)} |`,
    );
  }
  lines.push("");
  if (report.paired.length > 0) {
    lines.push("## Paired Comparisons", "");
    for (const p of report.paired) {
      lines.push(`**${p.a} vs ${p.b}**: ${p.verdict} (MDD ${(p.mdd * 100).toFixed(1)}%)`);
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
  validateProvenance(runJSONs);

  // Collect all jobs
  const frameworkJobs = new Map<string, JobJSON[]>();
  for (const { dir } of validRuns) {
    for (const job of readJobs(dir)) {
      if (!frameworkJobs.has(job.framework)) frameworkJobs.set(job.framework, []);
      frameworkJobs.get(job.framework)!.push(job);
    }
  }

  const frameworks: CombinedReport["frameworks"] = {};
  for (const [fw, jobs] of frameworkJobs) {
    frameworks[fw] = aggregateFramework(jobs);
  }

  const report: CombinedReport = {
    format: FORMAT_VERSION,
    name,
    runs: runJSONs.map((r) => r.id),
    provenance: runJSONs[0]!.provenance,
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
