/**
 * Expand a RunConfig into a list of jobs and compute a cost projection.
 * Runner architecture §3 (project cost), plan.ts responsibility from §1.
 */

import { readFileSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import type { RunConfig, Job, JobJSON } from "./types.ts";

/** Plan: the jobs to run and, if history is available, the projected cost. */
export interface Plan {
  jobs: Job[];
  /** Projected total cost in USD, undefined when no history exists. */
  projectedCostUsd?: number;
}

/**
 * Expands a RunConfig into a Job list: one entry per (problem, framework, rep) triple.
 * Jobs are interleaved by framework per problem so a budget stop leaves paired data
 * (runner §3, decided A-15).
 * @param config - resolved run config
 * @returns flat list of jobs
 */
export function expandJobs(config: RunConfig): Job[] {
  const jobs: Job[] = [];
  // Interleave: for each rep, iterate problems, for each problem iterate frameworks
  for (let rep = 0; rep < config.reps; rep++) {
    for (const problem of config.problems) {
      for (const framework of config.frameworks) {
        jobs.push({ problem, framework, rep });
      }
    }
  }
  return jobs;
}

/**
 * Reads job.json files from a run directory to extract cost history.
 * Silently skips files that cannot be read or parsed.
 * @param runDir - path to a run directory
 * @returns array of parsed job records
 */
function readRunJobRecords(runDir: string): JobJSON[] {
  const results: JobJSON[] = [];
  let entries: string[];
  try {
    entries = readdirSync(runDir);
  } catch {
    return results;
  }
  for (const entry of entries) {
    const jobPath = join(runDir, entry, "job.json");
    if (!existsSync(jobPath)) continue;
    try {
      const raw = JSON.parse(readFileSync(jobPath, "utf8")) as JobJSON;
      results.push(raw);
    } catch {
      // Skip malformed records
    }
  }
  return results;
}

/**
 * Loads all historical job records from the experiments/reports and experiments/runs directories.
 * @param repoRoot - project root containing `experiments/`
 */
function loadHistory(repoRoot: string): JobJSON[] {
  const records: JobJSON[] = [];

  const runsDir = join(repoRoot, "experiments", "runs");
  if (existsSync(runsDir)) {
    for (const runEntry of readdirSync(runsDir)) {
      records.push(...readRunJobRecords(join(runsDir, runEntry)));
    }
  }

  // Also look inside reports for embedded run data (not standard, but robust)
  const reportsDir = join(repoRoot, "experiments", "reports");
  if (existsSync(reportsDir)) {
    for (const reportEntry of readdirSync(reportsDir)) {
      const runsInReport = join(reportsDir, reportEntry, "runs");
      if (existsSync(runsInReport)) {
        for (const runEntry of readdirSync(runsInReport)) {
          records.push(...readRunJobRecords(join(runsInReport, runEntry)));
        }
      }
    }
  }

  return records;
}

/**
 * Computes the mean cost per job for a matching (problem, framework, tier) tuple from history.
 * Returns undefined if no matching history exists.
 * @param history - all historical job records
 * @param problem - problem id
 * @param framework - canonical framework variant string
 */
function meanCost(history: JobJSON[], problem: string, framework: string): number | undefined {
  const matching = history.filter((j) => j.problem === problem && j.framework === framework);
  if (matching.length === 0) return undefined;
  if (matching.some((j) => typeof j.costUsdAllAttempts !== "number" || !Number.isFinite(j.costUsdAllAttempts))) return undefined;
  const total = matching.reduce((sum, j) => sum + j.costUsdAllAttempts!, 0);
  return total / matching.length;
}

/**
 * Builds a plan: expands jobs from config and, if history is found, projects cost.
 * No history → allow run, no projection (runner §3).
 * @param config - resolved run config
 * @param repoRoot - repo root for reading `experiments/`
 * @returns plan with jobs and optional projected cost
 */
export function buildPlan(config: RunConfig, repoRoot: string): Plan {
  const jobs = expandJobs(config);
  if (config.usageMode === "subscription") return { jobs };
  const history = loadHistory(repoRoot);
  if (history.length === 0) return { jobs };

  let totalProjected = 0;
  let anyMissing = false;
  for (const job of jobs) {
    const mean = meanCost(history, job.problem, job.framework);
    if (mean === undefined) {
      anyMissing = true;
    } else {
      totalProjected += mean;
    }
  }

  // Only return a projection if we have data for every job; partial history means allow
  if (anyMissing) return { jobs };
  return { jobs, projectedCostUsd: totalProjected };
}
