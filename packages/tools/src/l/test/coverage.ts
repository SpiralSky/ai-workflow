import { cutList } from "../../search.ts";
import { needSidecar, type Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { normTarget } from "./common.ts";

/** `coverage`: lines of a file or symbol executed by a test run, with the uncovered ranges. */
export function makeCoverage(sc?: Sidecar): ToolDef {
  return {
    name: "coverage",
    description: "Run tests and report which lines of a file or symbol they execute (sys.monitoring). Returns covered/total lines, percent and the uncovered line ranges.",
    parameters: objectSchema({
      target: { type: "string", description: "File path, or symbol path#Name / path#Class.method, to measure." },
      tests: { type: "string", description: "Tests to run, as runTests target (default: all tests)." },
      timeoutMs: { type: "integer", description: "Kill the run after this many ms (default 120000, max 600000)." },
    }, ["target"]),
    returns: "{ path: string; symbol?: string; covered: number; total: number; percent: number; uncovered: [number, number][]; tests: { passed: number; skipped: number; failed: number }; truncated?: string }",
    meta: {
      whenToUse: "Find which lines a test run never executes, e.g. to see why a branch is untested or where to add a test.",
      whenNotToUse: "Not to see which tests fail (use runTests) or what values flow through calls (use traceCalls).",
      examples: ["coverage of app/store.py with all tests", "coverage of app/store.py#Store.save by tests/test_store.py"],
      category: "test",
      effect: "exec",
      requires: [],
      cost: 3,
    },
    async fn(args: { target: string; tests?: string; timeoutMs?: number }, ctx) {
      const sidecar = needSidecar(sc);
      const params: Record<string, unknown> = { target: normTarget(ctx.root, args.target), timeoutMs: args.timeoutMs };
      if (args.tests) params.tests = normTarget(ctx.root, args.tests);
      const res = (await sidecar.call("coverage", params, ctx.signal)) as { uncovered: unknown[]; truncated?: string };
      const { kept, truncated } = cutList(res.uncovered, 150, "pass a symbol to narrow");
      const hint = truncated ?? res.truncated;
      return hint ? { ...res, uncovered: kept, truncated: hint } : { ...res, uncovered: kept };
    },
  };
}
