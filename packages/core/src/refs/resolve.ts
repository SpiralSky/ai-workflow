import { createHash } from "node:crypto";
import { extractRefs, type RefToken } from "./parse.ts";
import { isLiveRef, RefError, type CallRecord, type LiveRef, type RefStore } from "./store.ts";

/** Inline limit in characters (about 500 tokens, references §5.1). */
export const INLINE_MAX_CHARS = 2000;
/** Cap on one `resolve` result in characters (about 1k tokens, orchestrate-engine §2). */
export const RESOLVE_MAX_CHARS = 4000;

/** Reads current workspace content; `readSymbol` is optional (S-only runs lack it). */
export interface CodeReader {
  readSymbol?(path: string, symbol: string): Promise<string>;
  readFile(path: string): Promise<string>;
}

/** Context for resolution. */
export interface ResolveContext {
  store: RefStore;
  reader: CodeReader;
}

/** Result of `resolve`. `step` is the step a snapshot came from (or, when stale, the step that changed a live target). */
export interface ResolveResult {
  text: string;
  stale: boolean;
  step?: number;
}

/** Arguments of `resolve`. */
export interface ResolveArgs {
  ref: string | LiveRef;
  grep?: string;
  lines?: [number, number];
  /** Output cap in characters; default {@link RESOLVE_MAX_CHARS}. */
  maxChars?: number;
}

/** Full content of a reference before slicing, plus what rendering needs. */
interface Content {
  text: string;
  stale: boolean;
  step?: number;
  summary: string;
}

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
const tokensOf = (chars: number) => (chars >= 4000 ? `${(chars / 4000).toFixed(1)}k tokens` : `${Math.ceil(chars / 4)} tokens`);
const render = (v: unknown) => (typeof v === "string" ? v : (JSON.stringify(v, null, 2) ?? "undefined"));
const oneLine = (s: string, n = 60) => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? t.slice(0, n - 1) + "…" : t;
};

/** Generates a call summary from tool name, args and outcome; no model call. */
function summariseCall(c: CallRecord, chars: number): string {
  const args = c.args && typeof c.args === "object" ? Object.values(c.args as object).find((v) => typeof v === "string") : c.args;
  const argText = typeof args === "string" ? ` \`${oneLine(args)}\`` : "";
  let outcome: string;
  if (c.outcome.error !== undefined) outcome = `threw ${oneLine(c.outcome.error, 80)}`;
  else if (c.outcome.exitCode !== undefined) outcome = `exit ${c.outcome.exitCode}`;
  else if (Array.isArray(c.result)) outcome = `${c.result.length} items`;
  else outcome = c.outcome.ok ? "ok" : "failed";
  return `step ${c.step}, ${c.tool}${argText}, ${tokensOf(chars)}: ${outcome}`;
}

/** Heuristic: does a read failure mean the target is gone? */
function isMissing(e: unknown): boolean {
  const err = e as { code?: string; name?: string; message?: string };
  return err?.code === "ENOENT" || err?.name === "RefNotFound" || /not found|no such file|ENOENT/i.test(err?.message ?? "");
}

/** Reads a code entity's current content, with the fallback marker when `readSymbol` is absent. */
async function readCode(ctx: ResolveContext, path: string, symbol?: string): Promise<string> {
  try {
    if (symbol === undefined) return await ctx.reader.readFile(path);
    if (ctx.reader.readSymbol) return await ctx.reader.readSymbol(path, symbol);
    return `[symbol extraction unavailable; whole file ${path}]\n${await ctx.reader.readFile(path)}`;
  } catch (e) {
    if (isMissing(e)) throw new RefError("RefNotFound", `${path}${symbol ? "#" + symbol : ""} no longer exists (${(e as Error).message})`);
    throw e;
  }
}

/** Splits `path#Symbol` as stored in a live ref. */
function splitCode(ref: string): { path: string; symbol?: string } {
  const body = ref.startsWith("@") ? ref.slice(1) : ref;
  const i = body.indexOf("#");
  return i < 0 ? { path: body } : { path: body.slice(0, i), symbol: body.slice(i + 1) };
}

/** Reads a live target; `version` (a content hash) enables the stale check. */
async function liveContent(ctx: ResolveContext, ref: string, version?: string): Promise<Content> {
  const { path, symbol } = splitCode(ref);
  const text = await readCode(ctx, path, symbol);
  const lines = text.split("\n").length;
  let stale = false;
  let step: number | undefined;
  if (version !== undefined && sha1(text) !== version) {
    stale = true;
    step = ctx.store.lastChangedBy(path);
  }
  return { text, stale, step, summary: `live, ${symbol ? `symbol ${symbol} in ${path}` : `file ${path}`}, ${lines} lines` };
}

/** Loads the full content of a token. */
async function contentOf(ctx: ResolveContext, t: RefToken): Promise<Content> {
  const { store } = ctx;
  switch (t.kind) {
    case "step": {
      const s = store.step(t.n);
      const text = `Instruction: ${s.instruction}\nReport: ${s.report ?? "(not finished)"}`;
      return { text, stale: false, step: t.n, summary: `step ${t.n}: ${oneLine(s.report ?? s.instruction, 100)}` };
    }
    case "range": {
      if (t.from > t.to) throw new RefError("invalid", `${t.raw}: range is backwards`);
      const parts: string[] = [];
      for (let n = t.from; n <= t.to; n++) {
        const s = store.step(n);
        parts.push(`--- step ${n} ---\nInstruction: ${s.instruction}\nReport: ${s.report ?? "(not finished)"}`);
      }
      return { text: parts.join("\n"), stale: false, step: t.to, summary: `steps ${t.from}-${t.to}` };
    }
    case "call": {
      const c = store.call(t.n, t.k);
      const text = render(c.result);
      return { text, stale: false, step: t.n, summary: summariseCall(c, text.length) };
    }
    case "named":
    case "namedAt": {
      const e = store.getNamed(t.name, t.kind === "namedAt" ? t.n : undefined);
      if (e.kind === "live" && isLiveRef(e.value)) {
        const live = await liveContent(ctx, e.value.ref, e.value.version);
        return { ...live, step: live.stale ? live.step : e.step, summary: e.summary ?? live.summary };
      }
      const text = render(e.value);
      const type = Array.isArray(e.value) ? `array of ${(e.value as unknown[]).length}` : typeof e.value;
      return { text, stale: false, step: e.step, summary: e.summary ?? `${type}, ${tokensOf(text.length)}` };
    }
    case "code":
      return liveContent(ctx, t.symbol === undefined ? t.path : `${t.path}#${t.symbol}`);
    case "malformed":
      throw new RefError("invalid", `${t.raw}: ${t.reason}`);
  }
}

/** Applies `lines` then `grep` (numbered with original line numbers), then the output cap. */
function slice(text: string, args: ResolveArgs): string {
  let all = text.split("\n");
  let first = 1;
  if (args.lines) {
    const [a, b] = args.lines;
    if (!Number.isInteger(a) || !Number.isInteger(b) || a < 1 || b < a) throw new RefError("invalid", `lines must be [from, to] with 1 <= from <= to, got [${a}, ${b}]`);
    all = all.slice(a - 1, b);
    first = a;
  }
  let out: string;
  if (args.grep !== undefined) {
    let re: RegExp;
    try {
      re = new RegExp(args.grep);
    } catch (e) {
      throw new RefError("invalid", `grep is not a valid regex: ${(e as Error).message}`);
    }
    const hits = all.flatMap((l, i) => (re.test(l) ? [`${first + i}: ${l}`] : []));
    out = hits.length ? hits.join("\n") : `(no lines match /${args.grep}/)`;
  } else out = all.join("\n");
  const cap = args.maxChars ?? RESOLVE_MAX_CHARS;
  if (out.length > cap) out = `${out.slice(0, cap)}\n… [truncated: showing ${cap} of ${out.length} chars; narrow with grep or lines]`;
  return out;
}

/**
 * `resolve`: returns the content of a reference, optionally sliced and always capped.
 * @param ctx - store and code reader
 * @param args - a token string (`"@s1.c1"`) or stored live-ref object, optional `grep` (regex, matching lines with numbers) or `lines` ([from, to], 1-based inclusive)
 * @returns `{ text, stale, step? }`; `stale` only for live refs whose content hash no longer matches their stored version (token code refs carry no version and are never stale)
 * @throws RefError: `RefNotFound` (unknown or deleted target), `expired` (evicted call), `invalid` (bad token, regex or range)
 */
export async function resolveRef(ctx: ResolveContext, args: ResolveArgs): Promise<ResolveResult> {
  let content: Content;
  if (typeof args.ref === "string") {
    const toks = extractRefs(args.ref.startsWith("@") ? args.ref : "@" + args.ref);
    if (toks.length !== 1 || toks[0]!.raw !== (args.ref.startsWith("@") ? args.ref : "@" + args.ref)) throw new RefError("invalid", `"${args.ref}" is not a single reference`);
    content = await contentOf(ctx, toks[0]!);
  } else if (isLiveRef(args.ref)) content = await liveContent(ctx, args.ref.ref, args.ref.version);
  else throw new RefError("invalid", "ref must be a reference token or a live-ref object { ref, version }");
  return { text: slice(content.text, args), stale: content.stale, step: content.step };
}

/** How one reference in an instruction was rendered. */
export interface RenderedRef {
  ref: string;
  mode: "inline" | "handle";
  chars: number;
  stale: boolean;
  /** Set for references found inside another reference's content (always handles). */
  nested?: boolean;
}

/** Output of {@link renderReferences}. */
export interface Rendered {
  /** Instruction followed by inline blocks, then handle lines. */
  text: string;
  inline: { ref: string; text: string }[];
  handles: string[];
  records: RenderedRef[];
}

/** Renders one token as an inline block or a handle line; null when it fails to resolve (nested only). */
async function renderOne(ctx: ResolveContext, t: RefToken, forceHandle: boolean): Promise<{ block?: string; handle?: string; rec: RenderedRef }> {
  const c = await contentOf(ctx, t);
  const stale = c.stale ? ` [stale${c.step ? `: changed in step ${c.step}` : ""}]` : "";
  const rec: RenderedRef = { ref: t.raw, mode: "inline", chars: c.text.length, stale: c.stale };
  if (!forceHandle && c.text.length <= INLINE_MAX_CHARS) {
    return { block: `${t.raw}${c.step && t.kind !== "code" ? ` (from step ${c.step})` : ""}${stale}:\n${c.text}`, rec };
  }
  rec.mode = "handle";
  return { handle: `${t.raw} — ${c.summary}${stale}`, rec };
}

/**
 * Renders the references in `instruction` for an executor (references §5): content up to
 * {@link INLINE_MAX_CHARS} is inlined below the instruction, larger content becomes a handle line
 * with a summary. References inside inline content are resolved one level deep and always as
 * handles (references §5.3). Duplicates are rendered once. The instruction text itself is kept
 * verbatim; validate it first with `validateRefs`.
 * @param ctx - store and code reader
 * @param instruction - text containing references
 * @throws RefError when a reference does not resolve
 */
export async function renderReferences(ctx: ResolveContext, instruction: string): Promise<Rendered> {
  const inline: Rendered["inline"] = [];
  const handles: string[] = [];
  const records: RenderedRef[] = [];
  const seen = new Set<string>();
  for (const t of extractRefs(instruction)) {
    if (seen.has(t.raw)) continue;
    seen.add(t.raw);
    const r = await renderOne(ctx, t, false);
    records.push(r.rec);
    if (r.handle) handles.push(r.handle);
    if (r.block === undefined) continue;
    inline.push({ ref: t.raw, text: r.block });
    // transitive: refs inside this content, one level, handles only
    for (const n of extractRefs(r.block.slice(r.block.indexOf(":\n") + 2))) {
      if (seen.has(n.raw)) continue;
      seen.add(n.raw);
      try {
        const nr = await renderOne(ctx, n, true);
        records.push({ ...nr.rec, nested: true });
        handles.push(nr.handle!);
      } catch {
        // dangling nested refs are not shown
      }
    }
  }
  const parts = [instruction];
  if (inline.length) parts.push(inline.map((i) => i.text).join("\n\n"));
  if (handles.length) parts.push("Handles (fetch with resolve):\n" + handles.join("\n"));
  return { text: parts.join("\n\n"), inline, handles, records };
}
