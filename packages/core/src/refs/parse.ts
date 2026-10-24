import type { RefStore } from "./store.ts";

/** One reference found in text. `start`/`end` are offsets of the whole token including `@`. */
export type RefToken = { raw: string; start: number; end: number } & RefBody;

/** The kind-specific part of a {@link RefToken}. */
export type RefBody =
  | { kind: "step"; n: number }
  | { kind: "range"; from: number; to: number }
  | { kind: "call"; n: number; k: number }
  | { kind: "named"; name: string }
  | { kind: "namedAt"; name: string; n: number }
  | { kind: "code"; path: string; symbol?: string }
  | { kind: "malformed"; reason: string };

/** A reference that failed validation. */
export interface RefIssue {
  token: RefToken;
  /** `malformed`, `unknown` (no such step/call/name/path) or `expired` (evicted call result). */
  problem: "malformed" | "unknown" | "expired";
  message: string;
}

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const RESERVED = /^s\d+$/;
const TOKEN_CHAR = /[^\s`'"<>]/;
const WORD_START = /[\s(\[{"'`<,;:]/;

/** True when `name` is a legal named-value name (not reserved for steps). */
export function isValidName(name: string): boolean {
  return NAME.test(name) && !RESERVED.test(name);
}

/** Classifies the text after `@` (references §4: step and call forms first, then names, then paths). */
function classify(body: string): RefBody {
  let m: RegExpExecArray | null;
  if ((m = /^s(\d+)\.\.s(\d+)$/.exec(body))) return { kind: "range", from: +m[1]!, to: +m[2]! };
  if ((m = /^s(\d+)\.c(\d+)$/.exec(body))) return { kind: "call", n: +m[1]!, k: +m[2]! };
  if ((m = /^s(\d+)$/.exec(body))) return { kind: "step", n: +m[1]! };
  if ((m = /^([A-Za-z_][A-Za-z0-9_]*)@s(\d+)$/.exec(body))) {
    return isValidName(m[1]!) ? { kind: "namedAt", name: m[1]!, n: +m[2]! } : { kind: "malformed", reason: `"${m[1]}" is reserved for steps` };
  }
  if (NAME.test(body)) return { kind: "named", name: body };
  if (/[/.]/.test(body)) {
    const hash = body.indexOf("#");
    const path = hash < 0 ? body : body.slice(0, hash);
    const symbol = hash < 0 ? undefined : body.slice(hash + 1);
    if (!path) return { kind: "malformed", reason: "empty path" };
    if (symbol !== undefined && !symbol) return { kind: "malformed", reason: "empty symbol after #" };
    return symbol === undefined ? { kind: "code", path } : { kind: "code", path, symbol };
  }
  return { kind: "malformed", reason: "not a step, call, name or path (a root file is written @./name)" };
}

/**
 * Finds the references in `text` (references §4). `@` starts a reference only at the start of a
 * word (start of text or after whitespace or one of `([{"'` + backtick + `<,;:`), so `a@b.com` is plain text;
 * `@@` is a literal `@`. A token runs to whitespace, a quote, a backtick or `<>`; trailing
 * `.,;:)!?]}` is not part of it. A bare `@` is ignored; an unrecognisable token is returned
 * with kind `malformed`.
 * @param text - an instruction or report
 * @returns tokens in text order
 */
export function extractRefs(text: string): RefToken[] {
  const out: RefToken[] = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] !== "@") continue;
    if (text[i + 1] === "@") {
      i++; // literal @
      continue;
    }
    if (i > 0 && !WORD_START.test(text[i - 1]!)) continue;
    let j = i + 1;
    while (j < text.length && TOKEN_CHAR.test(text[j]!)) j++;
    const raw = text.slice(i, j).replace(/[.,;:)!?\]}]+$/, "");
    if (raw.length <= 1) continue;
    out.push({ raw, start: i, end: i + raw.length, ...classify(raw.slice(1)) } as RefToken);
    i += raw.length - 1;
  }
  return out;
}

/** Replaces each `@@` in `text` with `@` (the literal-@ escape); call after resolving references. */
export function unescapeAt(text: string): string {
  return text.replace(/@@/g, "@");
}

/**
 * Lists every reference that is currently valid in `store`, for error messages: steps, calls
 * (compact per step), named values and their history. Code entities are any workspace path and are not listed.
 */
export function listValidRefs(store: RefStore): string[] {
  const out: string[] = [];
  for (let n = 1; n <= store.stepCount; n++) {
    out.push(`@s${n}`);
    const calls = store.callCount(n);
    if (calls) out.push(`@s${n}.c1..c${calls}`);
  }
  for (const name of store.names()) {
    out.push(`@${name}`);
    const hist = store.history(name);
    if (hist.length > 1) for (const h of hist) out.push(`@${name}@s${h.step}`);
  }
  return out;
}

/**
 * Validates tokens against the store. Paths are only checked when `pathExists` is given.
 * @param tokens - from {@link extractRefs}
 * @param store - the task's reference store
 * @param opts - `pathExists` checks a code entity's file
 * @returns one issue per invalid token (empty when all are valid)
 */
export async function validateRefs(tokens: RefToken[], store: RefStore, opts: { pathExists?: (path: string) => Promise<boolean> } = {}): Promise<RefIssue[]> {
  const issues: RefIssue[] = [];
  const bad = (token: RefToken, problem: RefIssue["problem"], message: string) => issues.push({ token, problem, message: `${token.raw}: ${message}` });
  const hasStep = (n: number) => n >= 1 && n <= store.stepCount;
  for (const t of tokens) {
    switch (t.kind) {
      case "malformed":
        bad(t, "malformed", t.reason);
        break;
      case "step":
        if (!hasStep(t.n)) bad(t, "unknown", `no step ${t.n}`);
        break;
      case "range":
        if (t.from > t.to) bad(t, "malformed", "range is backwards");
        else if (!hasStep(t.from) || !hasStep(t.to)) bad(t, "unknown", `steps run 1..${store.stepCount}`);
        break;
      case "call":
        if (!hasStep(t.n)) bad(t, "unknown", `no step ${t.n}`);
        else if (t.k < 1 || t.k > store.callCount(t.n)) bad(t, "unknown", `step ${t.n} has ${store.callCount(t.n)} calls`);
        else if (store.isEvicted(t.n, t.k)) bad(t, "expired", "result was dropped to stay under the size cap");
        break;
      case "named":
        if (!store.names().includes(t.name)) bad(t, "unknown", `no value named "${t.name}"`);
        break;
      case "namedAt":
        if (!hasStep(t.n)) bad(t, "unknown", `no step ${t.n}`);
        else if (!store.history(t.name).some((h) => h.step <= t.n)) bad(t, "unknown", `"${t.name}" had no value as of step ${t.n}`);
        break;
      case "code":
        if (opts.pathExists && !(await opts.pathExists(t.path))) bad(t, "unknown", `no such file "${t.path}"`);
        break;
    }
  }
  return issues;
}

/** Formats issues plus the valid references into one error message for the caller. */
export function formatRefIssues(issues: RefIssue[], store: RefStore): string {
  const valid = listValidRefs(store);
  return `Invalid reference${issues.length > 1 ? "s" : ""}:\n${issues.map((i) => `- ${i.message}`).join("\n")}\nValid references: ${valid.length ? valid.join(", ") : "(none yet)"}; code entities are written @path or @path#Symbol.`;
}
