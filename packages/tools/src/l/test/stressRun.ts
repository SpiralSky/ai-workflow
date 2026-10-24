import { needSidecar, type Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { normTarget } from "./common.ts";

/** `stressRun`: repeats a test or snippet and reports the failure rate and distinct failures. */
export function makeStressRun(sc?: Sidecar): ToolDef {
  return {
    name: "stressRun",
    description: "Run a test or snippet n times, optionally in parallel processes. Returns the failure rate and the first distinct failures (by exception type and location).",
    parameters: objectSchema({
      test: { type: "string", description: "Test to run, as runTests target (give this or snippet)." },
      snippet: { type: "string", description: "Python snippet to run (give this or test)." },
      n: { type: "integer", description: "Number of runs (default 20, max 200)." },
      parallel: { type: "integer", description: "Runs at the same time (default 4, max 16)." },
      timeoutMs: { type: "integer", description: "Stop starting runs after this many ms in total (default 60000, max 600000)." },
      runTimeoutMs: { type: "integer", description: "Kill one run after this many ms: a Timeout failure (default 30000)." },
    }),
    returns: "{ runs: number; failures: number; failureRate: number; distinct: { type: string; message: string; location: { path: string; line: number } | null; id?: string; count: number; firstRun: number }[]; timedOut?: true; truncated?: string }",
    meta: {
      whenToUse: "Reproduce flaky or concurrency failures: how often it fails and what the distinct failures are.",
      whenNotToUse: "Not for a single run (use runTests or runSnippet) or call-level detail (use traceCalls).",
      examples: ["run tests/test_cache.py#TestCache.test_race 50 times, 8 parallel", "run a snippet 100 times to see how often it raises"],
      category: "test",
      effect: "exec",
      requires: [],
      cost: 3,
    },
    async fn(args: { test?: string; snippet?: string; n?: number; parallel?: number; timeoutMs?: number; runTimeoutMs?: number }, ctx) {
      const params: Record<string, unknown> = { snippet: args.snippet, n: args.n, parallel: args.parallel, timeoutMs: args.timeoutMs, runTimeoutMs: args.runTimeoutMs };
      if (args.test) params.test = normTarget(ctx.root, args.test);
      return needSidecar(sc).call("stressRun", params, ctx.signal);
    },
  };
}
