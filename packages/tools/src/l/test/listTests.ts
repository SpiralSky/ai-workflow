import { cutList } from "../../search.ts";
import { relPath, resolveInRoot } from "../../paths.ts";
import { needSidecar, type Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";

/** `listTests`: test ids from a static scan, optionally only those reaching a symbol. */
export function makeListTests(sc?: Sidecar): ToolDef {
  return {
    name: "listTests",
    description: "List test ids (path#Class.test_x) without running anything, optionally only a file or directory, or only the tests that reach a symbol through calls or imports.",
    parameters: objectSchema({
      path: { type: "string", description: "Limit to this test file or directory." },
      symbol: { type: "string", description: "Only tests reaching this symbol (path#Name), as in impact." },
    }),
    returns: "{ tests: string[]; truncated?: string }",
    meta: {
      whenToUse: "See what tests exist, or pick the tests to run for a change to a symbol.",
      whenNotToUse: "Not to run tests (use runTests).",
      examples: ["list all tests", "tests that reach app/store.py#Store.save"],
      category: "test",
      effect: "read",
      requires: [],
      cost: 2,
    },
    async fn(args: { path?: string; symbol?: string }, ctx) {
      const sidecar = needSidecar(sc);
      const params: Record<string, unknown> = { symbol: args.symbol };
      if (args.path) params.path = relPath(ctx.root, resolveInRoot(ctx.root, args.path));
      const res = (await sidecar.call("listTests", params, ctx.signal)) as { tests: string[] };
      const { kept, truncated } = cutList(res.tests, 200, "pass path or symbol to narrow");
      return truncated ? { tests: kept, truncated } : { tests: kept };
    },
  };
}
