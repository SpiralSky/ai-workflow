import type { BranchResult, TraceLimits } from "../types.ts";
import { renderTraceLines } from "./trace.ts";

/** Full mode: trace rendering with no value truncation and no loop collapsing or event budget (the upper bound, BF §7.5). */
export function renderFullLines(result: BranchResult, source: string, limits: TraceLimits): string[] {
  return renderTraceLines(result, source, { ...limits, valueChars: Infinity, loopCollapse: Infinity, eventBudget: Infinity });
}
