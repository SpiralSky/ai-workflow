import { currentReporter, wrapTools, type Reporter } from "@aiw/telemetry";
import type { BranchTools, CallCtx } from "../branch/types.ts";
import type { Registry } from "../registry/types.ts";
import { capOutput, DEFAULT_OUTPUT_CAP } from "./cap.ts";
import type { Host } from "./types.ts";

/**
 * Builds the branch tool map: report -> cap -> host (core-tools-and-hosts §5). Each call's inner id
 * is its telemetry tool event id and its parent is the reporter's scope.
 * @param registry - registered tools
 * @param host - executes the calls (usually checked and composed)
 * @param opts - reporter to record under; `names` (normalised, default all routed tools); `outputCap` bytes; `onRaw` receives each call's uncapped result keyed by its per-call ctx
 * @throws Error if a name in `names` is not registered
 */
export function bindTools(
  registry: Registry,
  host: Host,
  opts: { reporter: Reporter; names?: string[]; outputCap?: number; onRaw?: (ctx: CallCtx, result: unknown) => void },
): BranchTools {
  const cap = opts.outputCap ?? DEFAULT_OUTPUT_CAP;
  const decls = opts.names
    ? opts.names.map((n) => {
        const d = registry.byName.get(n);
        if (!d) throw new Error(`unknown tool: ${n}`);
        return d;
      })
    : registry.decls.filter((d) => d.routing === "routed");
  const map: BranchTools = {};
  for (const decl of decls) {
    map[decl.name] = async (args, ctx: CallCtx) => {
      const result = await host.call(
        {
          id: currentReporter()?.scope ?? opts.reporter.newId(),
          parent: opts.reporter.scope ?? "",
          name: decl.hostName,
          args,
        },
        ctx,
      );
      opts.onRaw?.(ctx, result);
      return decl.capsOutput ? result : capOutput(result, cap);
    };
  }
  return wrapTools(map, opts.reporter);
}
