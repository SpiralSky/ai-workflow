import type { LLMClient, TranscriptWriter } from "@aiw/telemetry";
import type { IsolateRuntime } from "../branch/isolate.ts";
import type { FrameworkCall, FrameworkResult, FrameworkTool } from "../framework/types.ts";
import { loadPrompt } from "../framework/prompts.ts";
import type { Host } from "../host/types.ts";
import { extractRefs, formatRefIssues, isLiveRef, RefError, resolveRef, validateRefs, type CodeReader } from "../refs/index.ts";
import type { Registry } from "../registry/types.ts";
import { runExecutor, type ExecutorLimits, type HotPathSnippet } from "./executor.ts";
import type { Selector } from "./selection/index.ts";
import type { Task } from "./task.ts";

/** Cap on one planner `resolve` result, in characters (about 1k tokens at 4 chars/token, engine §2). */
export const PLANNER_RESOLVE_MAX_CHARS = 4000;

/** Everything the planner tools need. */
export interface PlannerToolsInput {
  task: Task;
  registry: Registry;
  host: Host;
  selector: Selector;
  /** Unwrapped client for the executor (turns are reported by the executor loop). */
  client: LLMClient;
  model: string;
  temperature?: number;
  transcript?: TranscriptWriter;
  reader: CodeReader;
  pathExists?: (path: string) => Promise<boolean>;
  runtime?: IsolateRuntime;
  hotPaths?: HotPathSnippet[];
  variant?: "branch" | "calls";
  limits?: ExecutorLimits;
}

const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));
const fail = (text: string): FrameworkResult => ({ text, isError: true });

/**
 * Builds the planner's `do` tool following the lifecycle of orchestrate-engine §3: validate
 * references, allocate `sN`, select, lock, run the executor, finalise, store the step, attach the
 * handoff, release the lock.
 * @param input - task, registry, host, selector, LLM and executor settings
 * @returns the `do` framework tool
 */
export function doTool(input: PlannerToolsInput): FrameworkTool {
  const { task, registry } = input;
  return {
    name: "do",
    description: loadPrompt("do-tool").trimEnd(),
    inputSchema: {
      type: "object",
      properties: {
        instruction: { type: "string", description: "The step, in natural language." },
        tools: { type: "array", items: { type: "string" }, description: "Explicit tool names for the executor, bypassing selection." },
      },
      required: ["instruction"],
      additionalProperties: false,
    },
    async handle(args: Record<string, unknown>, call: FrameworkCall): Promise<FrameworkResult> {
      const instruction = args.instruction;
      if (typeof instruction !== "string" || !instruction.trim()) return fail("do: `instruction` must be a non-empty string");
      let override: string[] | undefined;
      if (args.tools !== undefined) {
        if (!Array.isArray(args.tools) || args.tools.some((t) => typeof t !== "string")) return fail("do: `tools` must be an array of tool names");
        override = args.tools as string[];
        const unknown = override.filter((n) => registry.byName.get(n)?.routing !== "routed");
        if (unknown.length) return fail(`do: unknown tools: ${unknown.join(", ")}. Use names from the tool list, or omit \`tools\` to select automatically.`);
      }
      // 1. validate references: no step id is used on failure
      const issues = await validateRefs(extractRefs(instruction), task.store, { pathExists: input.pathExists });
      if (issues.length) return fail(formatRefIssues(issues, task.store));

      // 2. allocate the step
      const step = task.startStep({ instruction, executor: input.model });
      let lease: Awaited<ReturnType<Task["acquire"]>> | undefined;
      try {
        // 3. select
        const selection = await input.selector.select({ instruction, override, reporter: call.reporter }, registry.decls);
        // 4. lock: shared only when every shortlisted tool is read-only
        lease = await task.acquire(selection.tools.every((d) => d.meta.effect === "read") ? "shared" : "exclusive");
        const held = lease;
        // 5-8. snapshot, run, finalise (inside runExecutor)
        const result = await runExecutor({
          instruction,
          step,
          doEventId: call.reporter.scope ?? call.reporter.newId(),
          store: task.store,
          tracker: task.tracker,
          reporter: call.reporter,
          client: input.client,
          model: input.model,
          temperature: input.temperature,
          transcript: input.transcript,
          registry,
          host: input.host,
          reader: input.reader,
          pathExists: input.pathExists,
          runtime: input.runtime,
          selection,
          selector: input.selector,
          override,
          hotPaths: input.hotPaths,
          variant: input.variant,
          limits: input.limits,
          signal: call.signal,
          onAddTools: async (added) => {
            if (added.every((d) => d.meta.effect === "read")) return;
            await held.upgrade();
            // the wait may have let another step write; measure this step's changes from now on
            await task.tracker.begin();
          },
        });
        task.store.finishStep(step, { report: result.report, changed: result.changed });
        // 9. attach the handoff; the lock is released in finally
        call.reporter.attach("orchestrate.handoff", result.handoff);
        return { text: result.report, isError: false };
      } catch (e) {
        // a started step always ends, so `@sN` stays resolvable
        task.store.finishStep(step, { report: `(do failed: ${errText(e)})` });
        return fail(`do failed (step s${step}): ${errText(e)}`);
      } finally {
        lease?.release();
      }
    },
  };
}

/**
 * Builds the planner's read-only `resolve` tool (orchestrate §4.1), capped at 4 000 characters.
 * @param input - the task store and code reader
 * @returns the `resolve` framework tool
 */
export function plannerResolveTool(input: Pick<PlannerToolsInput, "task" | "reader">): FrameworkTool {
  return {
    name: "resolve",
    description: loadPrompt("resolve-tool").trimEnd(),
    inputSchema: {
      type: "object",
      properties: {
        ref: {
          anyOf: [
            { type: "string", description: "A reference such as `@s1.c2`, `@name` or `@src/a.py#Symbol`." },
            { type: "object", properties: { ref: { type: "string" }, version: { type: "string" } }, required: ["ref", "version"], description: "A stored live-ref object." },
          ],
        },
        grep: { type: "string", description: "Regex; returns only matching lines with line numbers." },
        lines: { type: "array", items: { type: "number" }, minItems: 2, maxItems: 2, description: "[from, to], 1-based inclusive." },
      },
      required: ["ref"],
      additionalProperties: false,
    },
    async handle(args: Record<string, unknown>): Promise<FrameworkResult> {
      const ref = args.ref;
      if (typeof ref !== "string" && !isLiveRef(ref)) return fail("resolve: `ref` must be a reference string or a live-ref object");
      if (args.grep !== undefined && typeof args.grep !== "string") return fail("resolve: `grep` must be a string");
      let lines: [number, number] | undefined;
      if (args.lines !== undefined) {
        if (!Array.isArray(args.lines) || args.lines.length !== 2) return fail("resolve: `lines` must be [from, to]");
        lines = args.lines as [number, number];
      }
      try {
        const r = await resolveRef(
          { store: input.task.store, reader: input.reader },
          { ref, grep: args.grep as string | undefined, lines, maxChars: PLANNER_RESOLVE_MAX_CHARS },
        );
        const stale = r.stale ? `\n[stale: the target changed${r.step !== undefined ? ` in step s${r.step}` : ""} since this reference was made]` : "";
        return { text: r.text + stale, isError: false };
      } catch (e) {
        if (e instanceof RefError) return fail(e.message);
        throw e;
      }
    },
  };
}
