/**
 * Run directory writer: creates and updates the run directory structure.
 * Data-formats §1; runner §7.
 */

import { mkdirSync, writeFileSync, renameSync, readdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import type { RunConfig, Provenance, JobJSON, RunJSON, Job } from "./types.ts";
import { FORMAT_VERSION } from "./types.ts";

/** Formats a Date as the run-id timestamp part: `2026-10-23T14-02-11Z`. */
function fmtTimestamp(d: Date): string {
  return d.toISOString().replace(/:/g, "-").replace(/\.\d+Z$/, "Z");
}

/** Generates a short random hex suffix (4 chars). */
function shortId(): string {
  return randomBytes(2).toString("hex");
}

/**
 * Generates a run id from the current time: `<ts>-<hex4>`.
 * @param now - timestamp to use (defaults to current time)
 */
export function generateRunId(now: Date = new Date()): string {
  return `${fmtTimestamp(now)}-${shortId()}`;
}

/**
 * Returns the job directory name for a job: `<problem>.<framework>.<rep>`.
 * `[`, `]`, `,`, `=` are kept (valid on Linux); the indexer URL-encodes them (data-formats §1).
 * @param job - job triple
 */
export function jobDirName(job: Job): string {
  return `${job.problem}.${job.framework}.${job.rep}`;
}

/** A handle to an open run directory. */
export interface RunDir {
  readonly runId: string;
  readonly path: string;
}

/**
 * Creates the run directory under `experiments/runs/<runId>/` and writes the initial run.json
 * with status "in-progress".
 * @param repoRoot - project root
 * @param runId - run id (from generateRunId)
 * @param config - resolved run config
 * @param provenance - computed provenance
 * @returns run dir handle
 */
export function createRunDir(
  repoRoot: string,
  runId: string,
  config: RunConfig,
  provenance: Provenance,
): RunDir {
  const path = join(repoRoot, "experiments", "runs", runId);
  mkdirSync(path, { recursive: true });

  const runJSON: RunJSON = {
    format: FORMAT_VERSION,
    id: runId,
    status: "in-progress",
    config,
    provenance,
    totals: { jobs: 0, attempts: 0, costUsd: 0, pass: 0, fail: 0 },
    startedAt: new Date().toISOString(),
  };
  writeRunJSON(path, runJSON);

  return { runId, path };
}

/**
 * Atomically writes run.json (write temp + rename) to avoid partial reads.
 * @param runPath - path to the run directory
 * @param data - run data to serialize
 */
export function writeRunJSON(runPath: string, data: RunJSON): void {
  const target = join(runPath, "run.json");
  const tmp = `${target}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2) + "\n", "utf8");
  renameSync(tmp, target);
}

/**
 * Creates the job subdirectory for one job attempt.
 * @param runPath - run directory path
 * @param job - job triple
 * @returns absolute path to the job directory
 */
export function createJobDir(runPath: string, job: Job): string {
  const dir = join(runPath, jobDirName(job));
  mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Creates the job attempt directory inside the job directory.
 * If this is a retry, previous attempts are moved to `attempts/<n>/`.
 * @param jobDir - job directory
 * @param attemptN - attempt number (0 = first)
 * @returns path to the attempt directory (same as jobDir for attempt 0)
 */
export function createAttemptDir(jobDir: string, attemptN: number): string {
  if (attemptN === 0) return jobDir;
  // Move the current content to attempts/<n-1>/
  const attemptsDir = join(jobDir, "attempts");
  mkdirSync(attemptsDir, { recursive: true });
  const archiveDir = join(attemptsDir, String(attemptN - 1));
  // The previous attempt's files are already in jobDir; the new attempt starts fresh
  if (existsSync(archiveDir)) throw new Error(`Attempt archive already exists: ${archiveDir}`);
  mkdirSync(archiveDir);
  for (const entry of readdirSync(jobDir)) {
    if (entry !== "attempts" && entry !== "job.json") renameSync(join(jobDir, entry), join(archiveDir, entry));
  }
  return jobDir;
}

/**
 * Writes job.json to the job directory.
 * @param jobDir - job directory
 * @param data - job result data
 */
export function writeJobJSON(jobDir: string, data: JobJSON): void {
  writeFileSync(join(jobDir, "job.json"), JSON.stringify(data, null, 2) + "\n", "utf8");
}
