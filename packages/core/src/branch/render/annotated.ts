import { compact, truncate } from "../limits.ts";
import type { BranchResult, TraceEvent, TraceLimits } from "../types.ts";
import { tailLines } from "./trace.ts";

/** Per-source-line annotation accumulator. */
interface Note {
  calls: { text: string; failed: boolean }[];
  conds: boolean[];
  loopIters?: number;
  parts: string[];
}

/**
 * Annotated rendering (BF §7.5): the full program with line numbers and end-of-line comments.
 * Lines run many times (loops) summarise: `→ first ×N`, `[taken ×2, not taken ×1]`, `×N`.
 * @returns the lines (no state footer)
 */
export function renderAnnotatedLines(result: BranchResult, source: string, limits: TraceLimits): string[] {
  const max = limits.valueChars;
  const notes = new Map<number, Note>();
  const note = (line: number): Note => {
    let n = notes.get(line);
    if (!n) notes.set(line, (n = { calls: [], conds: [], parts: [] }));
    return n;
  };
  const ends = new Map<number, Extract<TraceEvent, { type: "call"; phase: "end" }>>();
  for (const ev of result.trace) if (ev.type === "call" && ev.phase === "end") ends.set(ev.id, ev);

  for (const ev of result.trace) {
    switch (ev.type) {
      case "call": {
        if (ev.phase !== "start") break;
        const end = ends.get(ev.id);
        const text = !end || end.aborted ? "… aborted (in flight)"
          : end.ok ? `→ ${compact(end.result, max)}` : `[error: ${truncate(end.error ?? "error", max)}]`;
        note(ev.line).calls.push({ text, failed: end?.ok === false });
        break;
      }
      case "cond": note(ev.line).conds.push(Boolean(ev.value)); break;
      case "loop":
        if (ev.phase === "enter") note(ev.line).loopIters ??= 0;
        else if (ev.phase === "iter") note(ev.line).loopIters = (note(ev.line).loopIters ?? 0) + 1;
        break;
      case "log": note(ev.line).parts.push(`log: ${truncate(ev.message, max)}`); break;
      case "return": note(ev.line).parts.push(`→ ${compact(ev.value, max)} [returned]`); break;
      case "error": {
        const text = `[error: ${truncate(ev.message, max)}]`;
        const n = note(ev.lines[0] ?? 0);
        if (!n.calls.some((c) => c.failed)) n.parts.push(text);
        break;
      }
    }
  }

  const comment = (n: Note): string => {
    const out: string[] = [];
    if (n.loopIters !== undefined) out.push(`×${n.loopIters}`);
    if (n.calls.length === 1) out.push(n.calls[0]!.text);
    else if (n.calls.length > 1) {
      const failed = n.calls.filter((c) => c.failed).length;
      out.push(`${n.calls[0]!.text} ×${n.calls.length}${failed ? ` (${failed} err)` : ""}`);
    }
    if (n.conds.length === 1) out.push(n.conds[0] ? "[taken]" : "[not taken]");
    else if (n.conds.length > 1) {
      const t = n.conds.filter(Boolean).length;
      out.push(`[taken ×${t}, not taken ×${n.conds.length - t}]`);
    }
    return [...out, ...n.parts].join(" ");
  };

  const src = source.split(/\r?\n/);
  const width = String(src.length).length;
  const lines = src.map((text, i) => {
    const n = notes.get(i + 1);
    const c = n ? comment(n) : "";
    return `${String(i + 1).padStart(width)}  ${text}${c ? `  // ${c}` : ""}`;
  });
  return [...lines, ...tailLines(result, limits)];
}
