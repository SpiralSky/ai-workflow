import { readFileSync } from "node:fs";

/** One canned response: used when every key of `match` fits the call's arguments. */
interface FixtureCase { match: Record<string, unknown>; result: unknown }
/** Shape of `fixtures/external/<tool>.json`. */
interface FixtureFile { cases: FixtureCase[]; default: unknown }

const DIR = new URL("../../../fixtures/external/", import.meta.url);
const cache = new Map<string, FixtureFile>();

/** Loads (and caches) a tool's fixture file. @throws if the file is missing or malformed */
function load(tool: string): FixtureFile {
  let f = cache.get(tool);
  if (!f) {
    f = JSON.parse(readFileSync(new URL(`${tool}.json`, DIR), "utf8")) as FixtureFile;
    if (!Array.isArray(f.cases) || !("default" in f)) throw new Error(`bad fixture file: ${tool}.json`);
    cache.set(tool, f);
  }
  return f;
}

/**
 * Whether one argument value satisfies one match value. A string match value matches a string
 * argument case-insensitively as a substring (so `"login"` matches `"Login fails on retry"`); any
 * other value must be deeply equal (compared as JSON).
 */
function fits(arg: unknown, want: unknown): boolean {
  if (typeof want === "string") return typeof arg === "string" && arg.toLowerCase().includes(want.toLowerCase());
  return arg !== undefined && JSON.stringify(arg) === JSON.stringify(want);
}

/** Replaces `{{name}}` in every string of a fixture result with the argument `name` (empty if absent); deep-copies. */
function fill(v: unknown, args: Record<string, unknown>): unknown {
  if (typeof v === "string") return v.replace(/\{\{(\w+)\}\}/g, (_, k: string) => String(args[k] ?? ""));
  if (Array.isArray(v)) return v.map((x) => fill(x, args));
  if (v && typeof v === "object") return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, fill(x, args)]));
  return v;
}

/**
 * Canned response of an `external` tool (tool-catalog §5): the `result` of the first case whose
 * `match` keys all fit the arguments (see `fits`), else the file's `default`. Deterministic; string
 * results may reference arguments as `{{name}}`.
 * @param tool - tool name (fixture file `fixtures/external/<tool>.json`)
 * @param args - the call's argument object
 */
export function fixtureResult(tool: string, args: Record<string, unknown>): unknown {
  const f = load(tool);
  const hit = f.cases.find((c) => Object.entries(c.match).every(([k, want]) => fits(args[k], want)));
  return fill(hit ? hit.result : f.default, args);
}
