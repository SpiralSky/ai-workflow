import type { ToolDecl } from "../../registry/types.ts";

/**
 * Adds each tool's `requires` right after the requiring tool (orchestrate §7.3) and dedupes,
 * keeping first occurrences. Requirements are added one level deep and are looked up in the
 * whole catalog, whatever their routing. Unknown names are skipped with a warning.
 * @param tools - the shortlist, in order
 * @param catalog - all registered tools
 * @param warn - receives a message per unknown required name (default `console.warn`)
 * @returns the completed list
 */
export function complete(
  tools: ToolDecl[],
  catalog: ToolDecl[],
  warn: (msg: string) => void = (m) => console.warn(m),
): ToolDecl[] {
  const byName = new Map(catalog.map((d) => [d.name, d]));
  const out: ToolDecl[] = [];
  const seen = new Set<string>();
  const add = (d: ToolDecl) => {
    if (!seen.has(d.name)) {
      seen.add(d.name);
      out.push(d);
    }
  };
  for (const d of tools) {
    add(d);
    for (const r of d.meta.requires ?? []) {
      const req = byName.get(r);
      if (req) add(req);
      else warn(`Tool "${d.name}" requires unknown tool "${r}"`);
    }
  }
  return out;
}
