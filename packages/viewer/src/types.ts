/** Shared type definitions for the viewer data model. */

/** Index entry for a single run, stored in dist/data/index.js. */
export interface RunEntry {
  id: string;
  status: string;
  startedAt: string;
  endedAt: string | null;
  frameworks: string[];
  problems: string[];
  models: { main: string; secondary?: string };
  totals: { jobs: number; pass: number; fail: number; costUsd: number | null; attempts: number };
  provenance: Record<string, unknown>;
  jobs: JobSummary[];
}

/** Summary of one job inside the index. */
export interface JobSummary {
  name: string;
  problem: string;
  framework: string;
  rep: number;
  outcome: "pass" | "fail";
  reason: string | null;
  costUsdAllAttempts: number | null;
  durationMs: number;
  attempts: number;
}

/** Top-level index loaded from dist/data/index.js. */
export interface RunIndex {
  generated: string;
  runs: RunEntry[];
}

/** Event from events.jsonl. */
export interface RawEvent {
  v: number;
  id: string;
  parent: string | null;
  ts: number;
  kind: string;
  [key: string]: unknown;
}

/** Full job data loaded from dist/data/jobs/<run>/<job>.js. */
export interface JobData {
  runId: string;
  jobName: string;
  problem: string;
  framework: string;
  rep: number;
  outcome: "pass" | "fail";
  reason: string | null;
  costUsdAllAttempts: number | null;
  durationMs: number;
  attempts: AttemptRecord[];
  events: RawEvent[];
  diff: string;
  checkLog: string;
}

/** Attempt record from job.json. */
export interface AttemptRecord {
  n: number;
  final?: boolean;
  infraError?: string;
  costUsd?: number | null;
}

/** The global registration namespace injected by data scripts. */
export interface AIWGlobal {
  register: (key: string, data: unknown) => void;
  _data: Map<string, unknown>;
  _waiters: Map<string, Array<(v: unknown) => void>>;
}

declare global {
  interface Window {
    __aiw: AIWGlobal;
  }
}
