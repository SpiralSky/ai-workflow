import { canonicalJSON, sha256, wrapTools } from "@aiw/telemetry";
import { compileBranch } from "../branch/compile.ts";
import { quickJSRuntime } from "../branch/engines/index.ts";
import { renderTrace } from "../branch/render/index.ts";
import { runBranch } from "../branch/run.ts";
import type { BranchFail, BranchTools, State } from "../branch/types.ts";
import { bindTools } from "../host/bind.ts";
import { capOutput, DEFAULT_OUTPUT_CAP } from "../host/cap.ts";
import { declarations } from "../registry/declarations.ts";
import type { Registry, ToolDecl } from "../registry/types.ts";
import { loadPrompt } from "./prompts.ts";
import type { BuildOptions, Framework, FrameworkCall, FrameworkKind, FrameworkResult, FrameworkTool } from "./types.ts";

/** Hand-written declaration of the read-only `tools` inner call (kept out of the registry). */
const TOOLS_DECL: ToolDecl = {
  name: "tools",
  hostName: "tools",
  description: "Returns the full declarations of the named tools (all tools when `names` is omitted).",
  parameters: { type: "object", properties: { names: { type: "array", items: { type: "string" } } } },
  returns: "string",
  routing: "routed",
  capsOutput: true,
  meta: { whenToUse: "", effect: "read" },
};

/** Serialises async work per key object (core-branch §6). */
function mutex() {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const run = tail.then(fn, fn);
    tail = run.catch(() => {});
    return run;
  };
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Baseline: every routed tool is its own model-facing tool. */
function baselineTools(registry: Registry, opts: BuildOptions): FrameworkTool[] {
  return registry.decls
    .filter((d) => d.routing === "routed")
    .map((decl) => ({
      name: decl.name,
      description: decl.description,
      inputSchema: decl.parameters,
      async handle(args, call): Promise<FrameworkResult> {
        // No wrapTools here: the caller (runner/server) already records the outer tool event.
        try {
          let result = await opts.host.call(
            { id: call.reporter.scope ?? call.reporter.newId(), parent: "", name: decl.hostName, args },
            { signal: call.signal ?? new AbortController().signal, pauseTimeout: () => () => {} },
          );
          if (!decl.capsOutput) result = capOutput(result, opts.outputCap ?? DEFAULT_OUTPUT_CAP);
          const text = typeof result === "string" ? result : (JSON.stringify(result, null, 2) ?? "");
          return { text, isError: false };
        } catch (e) {
          return { text: errText(e), isError: true };
        }
      },
    }));
}

/** Branch-only: one `branch` tool over all routed tools. Returns the tool and its session state. */
function branchOnlyTool(registry: Registry, opts: BuildOptions, state: State): FrameworkTool {
  const routed = registry.decls.filter((d) => d.routing === "routed");
  const names = routed.map((d) => d.name);
  const cap = { maxChars: opts.maxChars, priority: opts.priority };
  let decls = declarations(routed, cap);
  // The `tools` inner call exists only when the cap actually omitted something; never itself capped.
  const hasToolsCall = opts.maxChars !== undefined && decls !== declarations(routed);
  if (hasToolsCall) decls += "\n" + declarations([TOOLS_DECL]);
  const description = loadPrompt("branch-tool").trimEnd() + "\n```ts\n" + decls + "\n```";
  const runtime = opts.runtime ?? quickJSRuntime;
  const serial = mutex();
  return {
    name: "branch",
    description,
    inputSchema: {
      type: "object",
      properties: {
        code: { type: "string", description: "The branch program: an async arrow function `async (tools, state) => { ... }`." },
        intent: { type: "string", description: "One-line label for this program." },
      },
      required: ["code"],
      additionalProperties: false,
    },
    handle: (args, call) =>
      serial(async (): Promise<FrameworkResult> => {
        const code = args.code;
        if (typeof code !== "string") return { text: "branch: `code` must be a string", isError: true };
        const mode = opts.branchContext ?? "trace";
        const render = (r: Parameters<typeof renderTrace>[0]) => renderTrace(r, { mode, source: code, state });
        const program = compileBranch(code);
        if ("error" in program) {
          const fail: BranchFail = { ok: false, error: "compile", message: program.message, line: program.line, trace: [] };
          return { text: render(fail), isError: true };
        }
        const tools: BranchTools = bindTools(registry, opts.host, { reporter: call.reporter, names, outputCap: opts.outputCap });
        if (hasToolsCall) {
          Object.assign(
            tools,
            wrapTools(
              {
                tools: (a: Record<string, unknown>) => {
                  const sel = Array.isArray(a?.names)
                    ? (a.names as string[]).map((n) => {
                        const d = registry.byName.get(n);
                        if (!d || d.routing !== "routed") throw new Error(`unknown tool: ${n}`);
                        return d;
                      })
                    : routed;
                  return declarations(sel);
                },
              },
              call.reporter,
            ),
          );
        }
        const result = await runBranch(
          program, tools, state,
          { signal: call.signal, onEvent: call.onEvent, timeoutMs: opts.timeoutMs, memoryMb: opts.memoryMb },
          runtime,
        );
        return { text: render(result), isError: !result.ok };
      }),
  };
}

/**
 * Assembles the model-facing tools and prompt section of a framework (core-tools-and-hosts §6).
 * @param kind - which framework
 * @param registry - registered tools
 * @param opts - host, runtime, render mode, declaration cap, limits
 * @throws Error for `orchestrate`, the `toolSearch` and `catalog` variants (not built yet), or an unknown kind
 */
export function buildFramework(kind: FrameworkKind, registry: Registry, opts: BuildOptions): Framework {
  if (opts.variant?.toolSearch) throw new Error("toolSearch is not built yet (needs the orchestrate selection stage)");
  if (opts.variant?.catalog !== undefined) throw new Error("catalog is not built yet (needs the orchestrate selection stage)");
  const state: State = {};
  let instructions: string;
  let tools: FrameworkTool[];
  if (kind === "baseline") {
    instructions = "";
    tools = baselineTools(registry, opts);
  } else if (kind === "branch-only") {
    instructions = loadPrompt("branch-only");
    tools = [branchOnlyTool(registry, opts, state)];
  } else if (kind === "orchestrate") {
    throw new Error("orchestrate is not built yet (needs the orchestrate selection stage)");
  } else {
    throw new Error(`unknown framework kind: ${String(kind)}`);
  }
  const toolsHash = sha256(canonicalJSON(tools.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }))));
  return { kind, instructions, tools, fingerprint: { promptHash: sha256(instructions), toolsHash }, state };
}
