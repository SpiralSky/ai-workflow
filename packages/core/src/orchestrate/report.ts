import { extractRefs, formatRefIssues, isLiveRef, sizeOf, validateRefs, type RefIssue, type RefStore } from "../refs/index.ts";
import type { ChangeSet } from "./changes.ts";

/** Default cap on model-written report text, in characters (orchestrate-engine §5.4). */
export const REPORT_MAX_CHARS = 2000;

/** Inputs of {@link finaliseReport}. */
export interface FinaliseInput {
  /** The executor's report text. */
  text: string;
  store: RefStore;
  /** Step id N of this `do` call (the footer's `Step: sN`). */
  step: number;
  changed: ChangeSet;
  /** The turn budget ran out. */
  exhausted: boolean;
  /**
   * Asks the executor for a corrected report, given the repair message. Pass it only while turn
   * budget remains (A-14); the repair turn counts against the cap. May return `undefined` to give up.
   */
  repair?: (message: string) => Promise<string | undefined>;
  /** Checks that a `@path` reference exists; code references are not checked when absent. */
  pathExists?: (path: string) => Promise<boolean>;
  /** Cap on model-written text; default {@link REPORT_MAX_CHARS}. */
  maxChars?: number;
}

/** Result of {@link finaliseReport}. */
export interface FinalisedReport {
  /** Report text plus the framework lines. */
  text: string;
  /** A repair turn was requested. */
  repaired: boolean;
}

/** Finds the issues in `text`'s references. */
async function check(text: string, input: FinaliseInput): Promise<RefIssue[]> {
  return validateRefs(extractRefs(text), input.store, { pathExists: input.pathExists });
}

/** Replaces each invalid reference token with `[invalid ref: <reason>]`. */
function replaceInvalid(text: string, issues: RefIssue[]): string {
  let out = text;
  for (const i of [...issues].sort((a, b) => b.token.start - a.token.start)) {
    out = out.slice(0, i.token.start) + `[invalid ref: ${i.message}]` + out.slice(i.token.end);
  }
  return out;
}

/** Cuts `text` to `max` chars, preferring a word boundary so a reference is not split. */
function capText(text: string, max: number): string {
  if (text.length <= max) return text;
  let cut = text.slice(0, max);
  const ws = cut.search(/\s\S*$/);
  if (ws > max - 80) cut = cut.slice(0, ws);
  return `${cut.trimEnd()}\n… [report truncated: showing ${cut.length} of ${text.length} chars; save large output and reference it instead of pasting]`;
}

/** The `Changed:` line. */
export function changedLine(c: ChangeSet): string {
  const parts = [...c.added.map((p) => `${p} (added)`), ...c.modified.map((p) => `${p} (modified)`), ...c.deleted.map((p) => `${p} (deleted)`)];
  return `Changed: ${parts.length ? parts.join(", ") : "none"}`;
}

/** The `Saved:` lines for names created or changed in `step`, or `undefined` when there are none. */
export function savedLines(store: RefStore, step: number): string | undefined {
  const rows: string[] = [];
  for (const name of store.names()) {
    const h = store.history(name);
    const e = h[h.length - 1]!;
    if (e.step !== step) continue;
    let desc = e.summary;
    if (desc === undefined) {
      if (e.kind === "live" && isLiveRef(e.value)) desc = `live, ${e.value.ref}`;
      else desc = `${Array.isArray(e.value) ? `array of ${e.value.length}` : typeof e.value}, ${sizeOf(e.value)} chars`;
    }
    rows.push(`@${name} — ${desc}`);
  }
  return rows.length ? "Saved: " + rows.join("\n       ") : undefined;
}

/**
 * Finalises an executor report (orchestrate-engine §5.4, A-14): validates its references (one
 * repair request when `repair` is given, else each invalid reference becomes `[invalid ref: …]`),
 * caps the model-written text, then appends `Changed:`, `Budget: exhausted` (when applicable),
 * `Saved:` and `Step: sN`.
 * @param input - report text, store, step, changes and the optional repair callback
 * @returns the final text and whether a repair turn was used
 */
export async function finaliseReport(input: FinaliseInput): Promise<FinalisedReport> {
  let text = input.text;
  let issues = await check(text, input);
  let repaired = false;
  if (issues.length && input.repair) {
    repaired = true;
    const msg = `${formatRefIssues(issues, input.store)}\nReply with the corrected report only.`;
    const next = await input.repair(msg);
    if (next !== undefined) {
      text = next;
      issues = await check(text, input);
    }
  }
  if (issues.length) text = replaceInvalid(text, issues);
  text = capText(text.trim(), input.maxChars ?? REPORT_MAX_CHARS);
  const lines = [text, changedLine(input.changed)];
  if (input.exhausted) lines.push("Budget: exhausted");
  const saved = savedLines(input.store, input.step);
  if (saved) lines.push(saved);
  lines.push(`Step: s${input.step}`);
  return { text: lines.join("\n"), repaired };
}
