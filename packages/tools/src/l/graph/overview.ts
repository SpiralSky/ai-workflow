import type { Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { CAPS, cutNamed, navCall, withHints } from "./common.ts";

/** `overview`: first look at a Python codebase as lists of modules, entry points, API, hotspots and tests. */
export function makeOverview(sc?: Sidecar): ToolDef {
  return {
    name: "overview",
    description: "Map an unfamiliar Python codebase: modules, entry points, public API, largest and most-connected symbols, test files and what they import.",
    parameters: objectSchema({}, []),
    returns: "{ modules: { path; symbols; imports; importedBy }[]; entryPoints: { kind: main|script; path?; line?; symbol?; name? }[]; publicApi: { path; via; names; more }[]; largest: { symbol; lines }[]; mostConnected: { symbol; callers; callees }[]; tests: { path; tests; imports }[]; unparsed: string[]; truncated?: string }",
    meta: {
      whenToUse: "First look at an unfamiliar codebase, before opening files.",
      whenNotToUse: "Not for one file's contents (use outline) or one symbol's relations (use callGraph, impact).",
      examples: ["what does this repo contain", "where do I start reading"],
      category: "graph",
      effect: "read",
      requires: [],
      cost: 2,
    },
    async fn(args: Record<string, unknown>, ctx) {
      const r = await navCall(sc, "overview", args, ctx);
      const hints: string[] = [];
      const tests = cutNamed("tests", r.tests as { imports: string[] }[], CAPS.testFiles, "use importGraph or findFiles", hints)
        .map((t) => (t.imports.length > 5 ? { ...t, imports: t.imports.slice(0, 5), moreImports: t.imports.length - 5 } : t));
      return withHints({
        modules: cutNamed("modules", r.modules, CAPS.modules, "outline a package directory or use importGraph", hints),
        entryPoints: cutNamed("entryPoints", r.entryPoints, CAPS.entryPoints, "use grep for __main__", hints),
        publicApi: cutNamed("publicApi", r.publicApi, CAPS.publicApi, "use outline on a module", hints),
        largest: cutNamed("largest", r.largest, CAPS.largest, "use outline", hints),
        mostConnected: cutNamed("mostConnected", r.mostConnected, CAPS.mostConnected, "use callGraph", hints),
        tests,
        unparsed: r.unparsed.slice(0, 5),
      }, hints);
    },
  };
}
