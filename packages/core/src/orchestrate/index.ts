export { ChangeTracker, snapshotWorkspace, diffSnapshots, gitignoreMatcher, IGNORED_DIRS } from "./changes.ts";
export type { ChangeSet, FileState, Snapshot } from "./changes.ts";
export { runExecutor, executorBranchDescription, META_DECLS, DEFAULT_TURNS, DEFAULT_ESCALATION_LIMIT, LAST_TURN_NOTICE } from "./executor.ts";
export type { ExecutorInput, ExecutorLimits, ExecutorResult, HotPathSnippet } from "./executor.ts";
export { finaliseReport, changedLine, savedLines, REPORT_MAX_CHARS } from "./report.ts";
export type { FinaliseInput, FinalisedReport } from "./report.ts";
export { buildHandoff } from "./handoff.ts";
export type { HandoffInput, HandoffRecord, HandoffRef, Escalation } from "./handoff.ts";
export { Task, RWLock, Lease, fsCodeReader, fsPathExists } from "./task.ts";
export type { LockMode } from "./task.ts";
export { doTool, plannerResolveTool, PLANNER_RESOLVE_MAX_CHARS } from "./planner-tools.ts";
export type { PlannerToolsInput } from "./planner-tools.ts";
export * from "./selection/index.ts";

export { hotPathCatalogFingerprint, HOT_PATH_PROMPT_KEY } from "./hot-paths/fingerprint.ts";
