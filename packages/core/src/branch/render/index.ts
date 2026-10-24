import { renderFooter } from "../footer.ts";
import { DEFAULT_TRACE_LIMITS, type BranchResult, type State, type TraceLimits } from "../types.ts";
import { renderAnnotatedLines } from "./annotated.ts";
import { renderFullLines } from "./full.ts";
import { renderTraceLines } from "./trace.ts";

/**
 * Renders a branch result as the model-facing text (BF §7).
 * @param result - outcome and trace from `runBranch`
 * @param opts - `mode`, the original `source`, optional `limits` and the post-run `state` (adds the footer)
 * @returns the rendered trace, ending with the state footer when state is non-empty
 */
export function renderTrace(
  result: BranchResult,
  opts: { mode: "trace" | "annotated" | "full"; source: string; limits?: TraceLimits; state?: State },
): string {
  const limits = opts.limits ?? DEFAULT_TRACE_LIMITS;
  const render = { trace: renderTraceLines, annotated: renderAnnotatedLines, full: renderFullLines }[opts.mode];
  const lines = render(result, opts.source, limits);
  const footer = opts.state ? renderFooter(opts.state) : "";
  if (footer) lines.push(footer);
  return lines.join("\n");
}
