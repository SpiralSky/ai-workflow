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
  /** Run budget in USD over every role's cost (API, price-table or API-equivalent). */
  budgetUsd: number;
  /** Both roles share this provider; omitted preserves the legacy OpenRouter default. */
  provider?: "openrouter" | "chatgpt" | "deepseek";
  /** ChatGPT plan runs only: call, token and time limits in addition to the budget. */
  subscriptionLimits?: import("./subscription.ts").SubscriptionLimits;
  concurrency: number;
  models: { main: string; secondary: string };
  classifier?: { provider: "openrouter-decisions" | "typesafe"; model: string; threshold: number; policy: "noul-v1" };
  temperature: number;
  secondaryCap: number;
  branch: BranchConfig;
}

/** Provenance recorded in run.json (runner §9). */
export interface Provenance {
  /** Static byte snapshots plus observations from actual runtime sessions, never requested placeholders. */
  integrity?: { version: 1; sourceHash: string; bundleHash: string; entryHash: string; promptHashes: Record<string, string>; configHash: string;
    runtime: "pending" | "observed"; nodeVersion?: string; runtimePlatform?: { platform: string; arch: string; moduleABI: string }; wallClockEnforced: false };
  commit: string;
  dirty: boolean;
  runnerVersion: string;
  engine: string;
  basePrompt: string;
  frameworks: Record<string, { prompt: string; tools: string; extra?: Record<string, string>; observedSettings?: Record<string, unknown> }>;
  images: Record<string, string>;
  inference?: { provider: string; mainModel: string; secondaryModel: string; temperature: number | null; store?: false; stream?: true };
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
  costUsd?: number | null;
  knownCostUsd?: number;
  costIncompleteReasons?: string[];
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
  costUsdAllAttempts: number | null;
  knownCostUsdAllAttempts?: number;
  costIncompleteReasons?: string[];
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
  totals: { jobs: number; attempts: number; costUsd: number | null; knownCostUsd?: number; pass: number; fail: number };
  subscriptionUsage?: import("./subscription.ts").SubscriptionUsage;
  startedAt: string;
  endedAt?: string;
}

/** Result returned by a completed job attempt. */
export interface JobResult {
  outcome: "pass" | "fail";
  reason: JobJSON["reason"];
  costUsd: number | null;
  knownCostUsd?: number;
  costIncompleteReasons?: string[];
  durationMs: number;
  rollups?: Record<string, unknown>;
  /** Absolute path to the events.jsonl file. */
  eventsPath: string;
}
