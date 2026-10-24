import { cutList } from "../../search.ts";
import { needSidecar, type Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { normTarget } from "./common.ts";

/** `runTests`: runs unittest tests in a child process and returns structured results. */
export function makeRunTests(sc?: Sidecar): ToolDef {
  return {
    name: "runTests",
    description: "Run unittest tests: all, a file or directory, one test (path#Class.test_x), or the previous failures. Returns pass count and per failure id, message, location, short excerpt.",
    parameters: objectSchema({
      target: { type: "string", description: "File, directory or id path#Class[.test_x] (default: all)." },
      failedOnly: { type: "boolean", description: "Re-run only the tests that failed or errored in the previous runTests call." },
      timeoutMs: { type: "integer", description: "Kill the run after this many ms (default 120000, max 600000)." },
    }),
    returns: "{ passed: number; skipped: number; failed: { id: string; kind: \"failure\" | \"error\"; message: string; location: { path: string; line: number } | null; excerpt: string }[]; truncated?: string }",
    meta: {
      whenToUse: "The default way to run tests: after an edit, to see which tests fail and where, or to re-run just the failures.",
      whenNotToUse: "Not for arbitrary commands (use bash) or for trying a few lines of code (use runSnippet).",
      examples: ["run all tests", "run tests/test_store.py#TestStore.test_save", "re-run only the failures"],
      category: "test",
      effect: "exec",
      requires: [],
      cost: 3,
    },
    async fn(args: { target?: string; failedOnly?: boolean; timeoutMs?: number }, ctx) {
      const sidecar = needSidecar(sc);
      const params: Record<string, unknown> = { failedOnly: args.failedOnly, timeoutMs: args.timeoutMs };
      if (args.target) params.target = normTarget(ctx.root, args.target);
      const res = (await sidecar.call("runTests", params, ctx.signal)) as { passed: number; skipped: number; failed: unknown[]; truncated?: string };
      const { kept, truncated } = cutList(res.failed, 15, "run a single test (target) or failedOnly for the rest");
      const hint = truncated ?? res.truncated;
      return hint ? { ...res, failed: kept, truncated: hint } : { ...res, failed: kept };
    },
  };
}
