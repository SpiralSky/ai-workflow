import { compact } from "./limits.ts";
import type { State } from "./types.ts";

/** Formats a byte count as `310B`, `42KB`, `1.5MB`. */
function size(bytes: number): string {
  const fmt = (n: number) => String(n < 10 ? Math.round(n * 10) / 10 : Math.round(n));
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${fmt(bytes / 1024)}KB`;
  return `${fmt(bytes / 1024 / 1024)}MB`;
}

/** Describes one state value: reference, scalar value, or type/count and size. */
function describe(v: unknown): string {
  if (v && typeof v === "object" && !Array.isArray(v) && typeof (v as { ref?: unknown }).ref === "string") {
    return `ref ${(v as { ref: string }).ref}`;
  }
  if (v === null || typeof v === "number" || typeof v === "boolean") return compact(v, 40);
  const bytes = Buffer.byteLength(JSON.stringify(v) ?? "", "utf8");
  if (typeof v === "string") return `string, ${size(bytes)}`;
  if (Array.isArray(v)) return `${v.length} items, ${size(bytes)}`;
  if (typeof v === "object") return `${Object.keys(v as object).length} keys, ${size(bytes)}`;
  return typeof v;
}

/**
 * Renders the state footer (BF §4.4, §7.3): `state: files(10 items, 42KB), parser(ref src/a.ts#f)`.
 * @param state - the branch state after the run
 * @returns the footer line, or "" when state is empty
 */
export function renderFooter(state: State): string {
  const keys = Object.keys(state);
  if (keys.length === 0) return "";
  return `state: ${keys.map((k) => `${k}(${describe(state[k])})`).join(", ")}`;
}
