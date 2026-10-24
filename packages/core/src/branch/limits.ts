/** One rendered unit of a trace: its text lines, and whether it survives event-budget elision. */
export interface Entry {
  lines: string[];
  /** Final return/error/abort entries are never elided. */
  keep?: boolean;
}

/**
 * Truncates text to `maxChars`, appending `…(+N chars)` with the number of chars cut.
 * @param text - text to limit
 * @param maxChars - limit; `Infinity` disables truncation
 */
export function truncate(text: string, maxChars: number): string {
  return text.length > maxChars ? `${text.slice(0, maxChars)}…(+${text.length - maxChars} chars)` : text;
}

const IDENT = /^[A-Za-z_$][\w$]*$/;

/** Renders a value as an untruncated JS-literal-ish string: `{code:0, out:""}`. */
function literal(v: unknown, seen: Set<object>): string {
  switch (typeof v) {
    case "string": return JSON.stringify(v);
    case "bigint": return `${v}n`;
    case "function": return "[Function]";
    case "object": break;
    default: return String(v);
  }
  if (v === null) return "null";
  if (seen.has(v)) return "[Circular]";
  seen.add(v);
  const out = Array.isArray(v)
    ? `[${v.map((x) => literal(x, seen)).join(", ")}]`
    : `{${Object.entries(v).map(([k, x]) => `${IDENT.test(k) ? k : JSON.stringify(k)}:${literal(x, seen)}`).join(", ")}}`;
  seen.delete(v);
  return out;
}

/**
 * Compact JS-literal rendering of a value (unquoted identifier keys, JSON strings), truncated
 * with a `…(+N chars)` marker.
 * @param value - any value
 * @param maxChars - limit; `Infinity` for no truncation
 */
export function compact(value: unknown, maxChars: number): string {
  return truncate(literal(value, new Set()), maxChars);
}

/** Collapses runs of whitespace to single spaces and trims. */
export function collapseWS(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Applies the event budget (BF §7.4): the first `budget` entries are kept, the rest are replaced
 * by `…N events elided` except `keep` entries, which follow the marker.
 * @returns the flattened output lines
 */
export function applyBudget(entries: Entry[], budget: number): string[] {
  if (entries.length <= budget) return entries.flatMap((e) => e.lines);
  const rest = entries.slice(budget);
  const kept = rest.filter((e) => e.keep);
  const elided = rest.length - kept.length;
  return [
    ...entries.slice(0, budget).flatMap((e) => e.lines),
    ...(elided > 0 ? [`…${elided} events elided`] : []),
    ...kept.flatMap((e) => e.lines),
  ];
}
