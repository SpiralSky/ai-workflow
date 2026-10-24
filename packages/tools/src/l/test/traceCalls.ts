import { needSidecar, type Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { normTarget } from "./common.ts";

/** `traceCalls`: runs a snippet or one test and records calls to chosen symbols. */
export function makeTraceCalls(sc?: Sidecar): ToolDef {
  return {
    name: "traceCalls",
    description: "Run a snippet or a test and record each call to the given symbols: args, return value or exception, thread and asyncio task, in call order (first 100).",
    parameters: objectSchema({
      symbols: { type: "array", items: { type: "string" }, description: "Functions or methods to trace, as path#Name (a class traces __init__); max 10." },
      snippet: { type: "string", description: "Python snippet to run (give this or test)." },
      test: { type: "string", description: "Test to run, as runTests target (give this or snippet)." },
      timeoutMs: { type: "integer", description: "Kill the run after this many ms (default 120000, max 600000)." },
    }, ["symbols"]),
    returns: "{ calls: { seq: number; symbol: string; args: Record<string, string>; thread: { id: number; name: string }; task?: string; returned?: string; raised?: string }[]; total: number; run: { value?: string; exception?: { type: string; message: string; location: { path: string; line: number } | null; traceback: string }; tests?: { passed: number; skipped: number; failed: string[] } }; truncated?: string }",
    meta: {
      whenToUse: "Debug races and wrong values: see which arguments reached a function, in what order, on which thread, and what it returned or raised.",
      whenNotToUse: "Not for line coverage (use coverage) or to repeat a flaky run (use stressRun).",
      examples: ["trace app/store.py#Store.save while running a snippet", "trace app/queue.py#Queue.put during tests/test_queue.py#TestQueue.test_race"],
      category: "test",
      effect: "exec",
      requires: [],
      cost: 3,
    },
    async fn(args: { symbols: string[]; snippet?: string; test?: string; timeoutMs?: number }, ctx) {
      const params: Record<string, unknown> = {
        symbols: args.symbols.map((s) => normTarget(ctx.root, s)),
        snippet: args.snippet,
        timeoutMs: args.timeoutMs,
      };
      if (args.test) params.test = normTarget(ctx.root, args.test);
      return needSidecar(sc).call("traceCalls", params, ctx.signal);
    },
  };
}
