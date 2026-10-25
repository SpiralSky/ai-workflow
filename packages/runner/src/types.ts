/**
 * Shared types for the @aiw/runner package.
 * Data-formats §1; runner architecture throughout.
 */

/** Current run-file format version. */
export const FORMAT_VERSION = 1;

/** Tool tier: S = small catalog, L = large catalog. */
export type Tier = "S" | "L";

/** Branch context mode. */
export type BranchContext = "trace" | "annotated" | "full";

/** Resolved branch sub-configuration. */
export interface BranchConfig {
  context: BranchContext;
  timeoutMs: number;
  limits: { valueChars: number; loopCollapse: number; eventBudget: number };
}

/** Resolved run configuration (data-formats §1.1 `config` field). */
export interface RunConfig {
  kind: "dev" | "pilot" | "full";
  problems: string[];
  /** Canonical framework variant strings (keys sorted). */
  frameworks: string[];
  tier: Tier;
  reps: number;
  budgetUsd: number;
  concurrency: number;
  models: { main: string; secondary: string };
  temperature: number;
  secondaryCap: number;
  branch: BranchConfig;
}

/** Provenance recorded in run.json (runner §9). */
export interface Provenance {
  commit: string;
  dirty: boolean;
  runnerVersion: string;
  engine: string;
  basePrompt: string;
  frameworks: Record<string, { prompt: string; tools: string; extra?: Record<string, string> }>;
  images: Record<string, string>;
  problems: Record<string, { taskHash: string; turnLimit: number; wallClockMs: number }>;
}

/** A single job: one (problem, framework, rep) triple. */
export interface Job {
  problem: string;
  framework: string;
  rep: number;
  /** Absolute path to the job directory, once allocated. */
  dir?: string;
}

/** Attempt record inside job.json. */
export interface AttemptRecord {
  n: number;
  infraError?: string;
  costUsd?: number;
  final?: true;
}

/** job.json shape (data-formats §1.2). */
export interface JobJSON {
  format: typeof FORMAT_VERSION;
  problem: string;
  framework: string;
  rep: number;
  outcome: "pass" | "fail";
  reason: null | "checks" | "turn-limit" | "timeout" | "patch-failed" | "context-limit";
  attempts: AttemptRecord[];
  costUsdAllAttempts: number;
  unmatchedProxyCostUsd?: number;
  flags?: string[];
  rollups?: Record<string, unknown>;
  durationMs: number;
}

/** run.json shape (data-formats §1.1). */
export interface RunJSON {
  format: typeof FORMAT_VERSION;
  id: string;
  status: "complete" | "in-progress" | { invalid: string };
  config: RunConfig;
  provenance: Provenance;
  totals: { jobs: number; attempts: number; costUsd: number; pass: number; fail: number };
  startedAt: string;
  endedAt?: string;
}

/** Result returned by a completed job attempt. */
export interface JobResult {
  outcome: "pass" | "fail";
  reason: JobJSON["reason"];
  costUsd: number;
  durationMs: number;
  rollups?: Record<string, unknown>;
  /** Absolute path to the events.jsonl file. */
  eventsPath: string;
}
