import { applyBudget, collapseWS, compact, truncate, type Entry } from "../limits.ts";
import type { BranchResult, TraceEvent, TraceLimits } from "../types.ts";

type CallStart = Extract<TraceEvent, { type: "call"; phase: "start" }>;
type CallEnd = Extract<TraceEvent, { type: "call"; phase: "end" }>;
type LoopEnter = Extract<TraceEvent, { type: "loop"; phase: "enter" }>;
type CondEvent = Extract<TraceEvent, { type: "cond" }>;
type ErrorEvent = Extract<TraceEvent, { type: "error" }>;

/** Event tree: loops hold their events grouped by iteration. */
type Node = { t: "ev"; ev: TraceEvent } | { t: "loop"; enter: LoopEnter; iters: Node[][] };

/** Lookup tables shared by the renderers. */
interface Ctx {
  limits: TraceLimits;
  source: string;
  ends: Map<number, CallEnd>;
  /** Calls whose lifetime overlaps another call's. */
  concurrent: Set<number>;
  /** Unhandled-error events that belong to a call, by call id. */
  callErrors: Map<number, ErrorEvent>;
  consumed: Set<ErrorEvent>;
  lastT: number;
}

/** Builds the lookup tables; concurrency is judged by event order (start index to end index). */
export function buildCtx(events: TraceEvent[], source: string, limits: TraceLimits): Ctx {
  const ends = new Map<number, CallEnd>();
  const callErrors = new Map<number, ErrorEvent>();
  const spans: { id: number; s: number; e: number }[] = [];
  const endIdx = new Map<number, number>();
  events.forEach((ev, i) => {
    if (ev.type === "call" && ev.phase === "end") { ends.set(ev.id, ev); endIdx.set(ev.id, i); }
    if (ev.type === "error" && ev.callId !== undefined) callErrors.set(ev.callId, ev);
  });
  events.forEach((ev, i) => {
    if (ev.type === "call" && ev.phase === "start") spans.push({ id: ev.id, s: i, e: endIdx.get(ev.id) ?? Infinity });
  });
  const concurrent = new Set<number>();
  for (const a of spans) for (const b of spans) if (a !== b && a.s < b.e && b.s < a.e) concurrent.add(a.id);
  return { limits, source, ends, concurrent, callErrors, consumed: new Set(), lastT: Math.max(0, ...events.map((e) => e.t)) };
}

/** Groups the flat event list into a tree; call end events are dropped (merged via `ctx.ends`). */
export function parseTree(events: TraceEvent[]): Node[] {
  let i = 0;
  const parseLoop = (enter: LoopEnter): Node => {
    const iters: Node[][] = [];
    while (i < events.length) {
      const e = events[i++]!;
      if (e.type === "loop" && e.phase === "exit") break;
      if (e.type === "loop" && e.phase === "iter") { iters.push([]); continue; }
      if (e.type === "call" && e.phase === "end") continue;
      if (iters.length === 0) iters.push([]);
      iters[iters.length - 1]!.push(e.type === "loop" && e.phase === "enter" ? parseLoop(e) : { t: "ev", ev: e });
    }
    return { t: "loop", enter, iters };
  };
  const out: Node[] = [];
  while (i < events.length) {
    const e = events[i++]!;
    if (e.type === "loop" && e.phase === "enter") out.push(parseLoop(e));
    else if (e.type !== "loop" && !(e.type === "call" && e.phase === "end")) out.push({ t: "ev", ev: e });
  }
  return out;
}

const L = (line: number) => `L${line}  `;
const atLine = (lines: number[]) => `    at ${lines.map((l) => `L${l}`).join(" ← ")}`;

/** True for a call that was cut off: no end event, or an end flagged `aborted`. */
function inFlight(ctx: Ctx, c: CallStart): boolean {
  const end = ctx.ends.get(c.id);
  return !end || end.aborted === true;
}

/** Clause head of a switch case (up to its colon, skipping quoted text) or a catch (`catch (e)`). */
function clauseHead(kind: "switch" | "catch", text: string): string {
  if (kind === "catch") {
    const m = /^catch\s*(\([^)]*\))?/.exec(text);
    return m ? collapseWS(m[0]) : "catch";
  }
  let quote = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (quote) { if (ch === "\\") i++; else if (ch === quote) quote = ""; }
    else if (ch === '"' || ch === "'" || ch === "`") quote = ch;
    else if (ch === ":") return collapseWS(text.slice(0, i + 1));
  }
  return collapseWS(text);
}

/** Text of a source range as a single collapsed line. */
function sourceText(ctx: Ctx, ev: CondEvent): string {
  return collapseWS(ctx.source.slice(ev.pos, ev.end));
}

function renderCall(ctx: Ctx, c: CallStart): Entry {
  const max = ctx.limits.valueChars;
  const id = ctx.concurrent.has(c.id) ? `#${c.id} ` : "";
  let line = `${L(c.line)}${id}${c.name}(${c.args === undefined ? "" : compact(c.args, max)})`;
  const end = ctx.ends.get(c.id);
  const lines: string[] = [];
  if (!end || end.aborted) {
    line += ` … aborted after ${end ? end.ms : ctx.lastT - c.t}ms (in flight)`;
    return { lines: [line], keep: true };
  }
  if (end.ok) return { lines: [`${line} → ${compact(end.result, max)} (${end.ms}ms)`] };
  lines.push(`${line} ✗ ${truncate(end.error ?? "error", max)}`);
  const err = ctx.callErrors.get(c.id);
  if (err) {
    ctx.consumed.add(err);
    lines.push(atLine(err.lines));
  }
  return { lines, keep: err !== undefined };
}

function renderEvent(ctx: Ctx, ev: TraceEvent): Entry[] {
  const max = ctx.limits.valueChars;
  switch (ev.type) {
    case "call":
      return ev.phase === "start" ? [renderCall(ctx, ev)] : [];
    case "cond": {
      const text = sourceText(ctx, ev);
      if (ev.kind === "switch" || ev.kind === "catch") return [{ lines: [`${L(ev.line)}${clauseHead(ev.kind, text)}`] }];
      const cond = ev.kind === "if" ? `if (${truncate(text, max)})` : `?: ${truncate(text, max)}`;
      return [{ lines: [`${L(ev.line)}${cond} → ${compact(ev.value, max)}`] }];
    }
    case "log": {
      const label = ev.level === "warn" || ev.level === "error" ? ev.level : "log";
      return [{ lines: [`${L(ev.line)}${label}: ${truncate(ev.message, max)}`] }];
    }
    case "return":
      return [{ lines: [`${L(ev.line)}return${ev.value === undefined ? "" : ` ${compact(ev.value, max)}`}`], keep: true }];
    case "error": {
      if (ctx.consumed.has(ev)) return [];
      const head = `${ev.lines.length ? L(ev.lines[0]!) : ""}throw: ${truncate(ev.message, max)}`;
      return [{ lines: ev.lines.length ? [head, atLine(ev.lines)] : [head], keep: true }];
    }
    default:
      return [];
  }
}

/** Walks a node subtree, calling `visit(event, iteration)` where iteration is the top-level index. */
function walk(nodes: Node[], iteration: number, visit: (ev: TraceEvent, iteration: number) => void): void {
  for (const n of nodes) {
    if (n.t === "ev") visit(n.ev, iteration);
    else n.iters.forEach((it) => walk(it, iteration, visit));
  }
}

function renderLoop(ctx: Ctx, loop: Extract<Node, { t: "loop" }>): Entry[] {
  const { enter, iters } = loop;
  if (iters.length <= ctx.limits.loopCollapse) return iters.flatMap((it) => renderNodes(ctx, it));

  const failing = new Set<number>();
  const groups = new Map<string, { line: number; name: string; error: string; count: number; iters: number[] }>();
  const hoisted: Entry[] = [];
  iters.forEach((it, idx) =>
    walk(it, idx, (ev) => {
      if (ev.type === "call" && ev.phase === "start") {
        const end = ctx.ends.get(ev.id);
        if (inFlight(ctx, ev)) hoisted.push(...renderEvent(ctx, ev));
        else if (end && !end.ok) {
          failing.add(idx);
          const error = end.error ?? "error";
          const g = groups.get(`${ev.line}|${ev.name}|${error}`) ?? { line: ev.line, name: ev.name, error, count: 0, iters: [] };
          g.count++;
          if (!g.iters.includes(idx + 1)) g.iters.push(idx + 1);
          groups.set(`${ev.line}|${ev.name}|${error}`, g);
        }
      } else if (ev.type === "return" || ev.type === "error") hoisted.push(...renderEvent(ctx, ev));
    }),
  );
  const range = enter.endLine > enter.line ? `L${enter.line}–${enter.endLine}` : `L${enter.line}`;
  const n = iters.length;
  const lines = [`${range}  ${enter.kind.startsWith("for") ? "for" : enter.kind} ×${n} (${n - failing.size} ok, ${failing.size} err)`];
  for (const g of groups.values()) {
    const shown = g.iters.slice(0, 10).join(", ") + (g.iters.length > 10 ? ", …" : "");
    lines.push(
      `        L${g.line} ${g.name} ✗ ${truncate(g.error, ctx.limits.valueChars)}${g.count > 1 ? ` ×${g.count}` : ""} ` +
        `(iteration${g.iters.length > 1 ? "s" : ""} ${shown})`,
    );
  }
  return [{ lines }, ...hoisted];
}

function renderNodes(ctx: Ctx, nodes: Node[]): Entry[] {
  return nodes.flatMap((n) => (n.t === "loop" ? renderLoop(ctx, n) : renderEvent(ctx, n.ev)));
}

/**
 * Lines that close every rendering: compile error, an unhandled throw missing from the events,
 * the kill marker, the state-reverted note and dropped state keys.
 */
export function tailLines(result: BranchResult, limits: TraceLimits): string[] {
  const out: string[] = [];
  if (!result.ok) {
    const msg = truncate(result.message, limits.valueChars);
    if (result.error === "compile") out.push(`${result.line !== undefined ? L(result.line) : ""}compile error: ${msg}`);
    else if (result.error === "thrown" && !result.trace.some((e) => e.type === "error")) {
      out.push(`${result.line !== undefined ? L(result.line) : ""}throw: ${msg}`);
    } else if (result.error === "timeout") out.push("    [aborted: timeout]");
    else if (result.error === "aborted") out.push("    [aborted]");
    else if (result.error === "memory") out.push("    [memory limit exceeded]");
    if (result.stateReverted) out.push("    [state reverted to the last tool-call snapshot]");
  }
  if (result.droppedKeys?.length) out.push(`    [state keys dropped (not JSON): ${result.droppedKeys.join(", ")}]`);
  return out;
}

/**
 * Trace-mode rendering (BF §7.3): a line-prefixed log of calls, conditions, logs and the
 * outcome, with loops collapsed and the event budget applied.
 * @param result - branch outcome with its trace
 * @param source - original program text (for condition text)
 * @param limits - value, loop and event limits; use `Infinity` to disable
 * @returns the lines (no state footer)
 */
export function renderTraceLines(result: BranchResult, source: string, limits: TraceLimits): string[] {
  const ctx = buildCtx(result.trace, source, limits);
  const entries = renderNodes(ctx, parseTree(result.trace));
  return [...applyBudget(entries, limits.eventBudget), ...tailLines(result, limits)];
}
