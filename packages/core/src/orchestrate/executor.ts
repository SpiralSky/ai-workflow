import { createHash } from "node:crypto";
import { currentReporter, wrapLLM, wrapTools, type LLMClient, type Reporter, type TranscriptWriter } from "@aiw/telemetry";
import { compileBranch } from "../branch/compile.ts";
import { quickJSRuntime } from "../branch/engines/index.ts";
import type { IsolateRuntime } from "../branch/isolate.ts";
import { renderTrace } from "../branch/render/index.ts";
import { runBranch } from "../branch/run.ts";
import type { BranchFail, BranchTools, CallCtx } from "../branch/types.ts";
import { loadPrompt } from "../framework/prompts.ts";
import { bindTools } from "../host/bind.ts";
import type { Host } from "../host/types.ts";
import { RefStore, RefError, resolveRef, renderReferences, stateProxy, type CallOutcome, type CodeReader, type ResolveContext } from "../refs/index.ts";
import { declarations } from "../registry/declarations.ts";
import type { Registry, ToolDecl } from "../registry/types.ts";
import type { ChangeSet, ChangeTracker } from "./changes.ts";
import { buildHandoff, type Escalation, type HandoffRecord } from "./handoff.ts";
import { finaliseReport } from "./report.ts";
import type { Selection, Selector } from "./selection/index.ts";

/** Default executor turn budget (secondary turn cap, orchestrate §8.2). */
export const DEFAULT_TURNS = 4;
/** Default number of tools one `findTools` call adds. */
export const DEFAULT_ESCALATION_LIMIT = 6;
/** Appended before the last allowed turn (orchestrate §8.2). */
export const LAST_TURN_NOTICE = "This is your last turn: report what you have.";

/** A hot-path snippet to include in the prompt (orchestrate-engine §4.5); the index is built elsewhere. */
export interface HotPathSnippet {
  id: string;
  description: string;
  code: string;
}

/** Limits and rendering options of one executor run. */
export interface ExecutorLimits {
  /** Turn budget, default {@link DEFAULT_TURNS}. */
  turns?: number;
  /** Cap on model-written report text, default 2000 chars. */
  reportMaxChars?: number;
  /** Tools added per `findTools` call, default {@link DEFAULT_ESCALATION_LIMIT} (= shortlist N, arch §4.4). */
  escalationLimit?: number;
  outputCap?: number;
  timeoutMs?: number;
  memoryMb?: number;
  branchContext?: "trace" | "annotated" | "full";
}

/** Inputs of {@link runExecutor}. The caller owns step allocation, locking, selection, storing the step and attaching the handoff. */
export interface ExecutorInput {
  /** The instruction as the planner wrote it (references already validated). */
  instruction: string;
  /** Step number N, already started in `store` (`store.startStep`). */
  step: number;
  /** Event id of the `do` call; the transcript session is `exec:<doEventId>`. */
  doEventId: string;
  store: RefStore;
  /** Tracks workspace changes; `begin()` and `end()` are called here. */
  tracker: ChangeTracker;
  /** Reporter scoped under the `do` event. */
  reporter: Reporter;
  /** Unwrapped client; each request is reported as a secondary `turn` through `wrapLLM`. */
  client: LLMClient;
  model: string;
  temperature?: number;
  transcript?: TranscriptWriter;
  registry: Registry;
  host: Host;
  /** Reads current code for `resolve`, `refSymbol` and inline reference rendering. */
  reader: CodeReader;
  /** Checks `@path` references in the report; code references are not checked when absent. */
  pathExists?: (path: string) => Promise<boolean>;
  runtime?: IsolateRuntime;
  /** The initial shortlist. */
  selection: Selection;
  selector: Selector;
  /** The planner's `tools` override, recorded in the handoff. */
  override?: string[];
  hotPaths?: HotPathSnippet[];
  /** `branch` (default) or `calls` (not built yet). */
  variant?: "branch" | "calls";
  limits?: ExecutorLimits;
  signal?: AbortSignal;
  /** Called with the new tools before a `findTools` result makes them callable (the caller upgrades its lock here). */
  onAddTools?: (tools: ToolDecl[]) => Promise<void>;
}

/** Result of {@link runExecutor}. */
export interface ExecutorResult {
  /** Final report with the framework lines; return it to the planner and store it on the step. */
  report: string;
  changed: ChangeSet;
  /** Attach with `reporter.attach("orchestrate.handoff", handoff)`. */
  handoff: HandoffRecord;
  turns: number;
  exhausted: boolean;
}

const metaDecl = (name: string, description: string, properties: Record<string, unknown>, required: string[], returns: string): ToolDecl => ({
  name,
  hostName: name,
  description,
  parameters: { type: "object", properties, required },
  returns,
  routing: "routed",
  capsOutput: true,
  meta: { whenToUse: "", effect: "read" },
});

/** Declarations of the meta-tools shown in the fixed `branch` description (orchestrate §4.2). */
export const META_DECLS: ToolDecl[] = [
  metaDecl("findTools", "Finds more tools for a need the listed tools cannot serve and makes them callable; returns their declarations.", { need: { type: "string", description: "What you need to do, in a short phrase." } }, ["need"], "string"),
  metaDecl(
    "resolve",
    "Returns the content of a reference (`@s1.c2`, `@name`, `@path#Symbol`) or a stored live ref, optionally only matching lines or a line range.",
    {
      ref: { anyOf: [{ type: "string" }, { type: "object", properties: { ref: { type: "string" }, version: { type: "string" } }, required: ["ref", "version"] }] },
      grep: { type: "string", description: "Regex; returns matching lines with line numbers." },
      lines: { type: "array", items: { type: "number" }, description: "[from, to], 1-based inclusive." },
    },
    ["ref"],
    "{ text: string; stale: boolean; step?: number }",
  ),
  metaDecl(
    "save",
    "Keeps a JSON value under a name that later steps can reference as `@name`. Same as `state[name] = value`, with a summary.",
    { name: { type: "string" }, value: {}, summary: { type: "string", description: "One line describing the value." } },
    ["name", "value"],
    "string",
  ),
  metaDecl(
    "refSymbol",
    "Returns a live reference to a symbol (or a whole file when `name` is omitted) that resolves to its current content. Keep it with `state.x = await tools.refSymbol(...)`.",
    { file: { type: "string" }, name: { type: "string", description: "Symbol path inside the file, e.g. `Class.method`." } },
    ["file"],
    "{ ref: string; version: string }",
  ),
];

let cachedDescription: string | undefined;

/** The fixed description of the executor's `branch` tool: identical for every executor (arch §5.1). */
export function executorBranchDescription(): string {
  cachedDescription ??= loadPrompt("branch-tool").trimEnd() + "\n\nTools:\n```ts\n" + declarations(META_DECLS) + "\n```";
  return cachedDescription;
}

/** The model-facing `branch` tool definition in function-calling format. */
function branchToolDef(): unknown {
  return {
    type: "function",
    function: {
      name: "branch",
      description: executorBranchDescription(),
      parameters: {
        type: "object",
        properties: {
          code: { type: "string", description: "The branch program: an async arrow function `async (tools, state) => { ... }`." },
          intent: { type: "string", description: "One-line label for this program." },
        },
        required: ["code"],
        additionalProperties: false,
      },
    },
  };
}

const sha1 = (s: string) => createHash("sha1").update(s).digest("hex");
const errText = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Outcome of a recorded call. */
function outcomeOf(result: unknown, error?: string): CallOutcome {
  if (error !== undefined) return { ok: false, error };
  const code = result && typeof result === "object" ? (result as { exitCode?: unknown }).exitCode : undefined;
  return typeof code === "number" ? { ok: code === 0, exitCode: code } : { ok: true };
}

/** One assistant message of an OpenAI-style response. */
interface AssistantMessage {
  content?: string | null;
  tool_calls?: { id: string; function: { name: string; arguments: string } }[];
  [k: string]: unknown;
}

/**
 * Runs one executor (orchestrate-engine §5): builds the handoff request, loops over model turns
 * running `branch` programs until a plain-text report or the turn cap, records every inner call
 * as `sN.cK`, and finalises the report.
 * @param input - see {@link ExecutorInput}
 * @returns the final report, the changed paths, the handoff record and turn usage
 * @throws Error for `variant: "calls"` (not built yet); RefError when an instruction reference does not resolve; LLM and abort errors from the client
 */
export async function runExecutor(input: ExecutorInput): Promise<ExecutorResult> {
  if ((input.variant ?? "branch") === "calls") throw new Error("executor variant `calls` is not built yet");
  const { store, step, reporter, registry } = input;
  const limits = input.limits ?? {};
  const cap = Math.max(1, limits.turns ?? DEFAULT_TURNS);
  const escalationLimit = limits.escalationLimit ?? DEFAULT_ESCALATION_LIMIT;
  const runtime = input.runtime ?? quickJSRuntime;
  const rctx: ResolveContext = { store, reader: input.reader };

  const present = new Map<string, ToolDecl>(input.selection.tools.map((d) => [d.name, d]));
  const shortlist = [...present.keys()];
  const escalations: Escalation[] = [];
  const state = stateProxy(store, step);

  // ---- first request (arch §5.1)
  await input.tracker.begin();
  const rendered = await renderReferences(rctx, input.instruction);
  const parts = [rendered.text];
  const hotPaths = input.hotPaths ?? [];
  if (hotPaths.length) {
    parts.push("Known-good patterns (adapt them; do not copy blindly):\n" + hotPaths.map((h) => `// ${h.id}: ${h.description}\n\`\`\`ts\n${h.code}\n\`\`\``).join("\n"));
  }
  parts.push(`This is step s${step}; your tool calls are numbered @s${step}.c1, @s${step}.c2, … in call order (meta-tool calls included).`);
  parts.push(`You have ${cap} turn${cap === 1 ? "" : "s"}.`);
  parts.push(
    "Tools (callable as `tools.name(...)` in a branch program, best fit first):\n" +
      (present.size ? "```ts\n" + declarations([...present.values()]) + "\n```" : "(none selected; call findTools)"),
  );
  const messages: unknown[] = [{ role: "user", content: parts.join("\n\n") }];
  const system = loadPrompt("executor");
  const llm = wrapLLM(input.client, reporter, "secondary", { transcript: input.transcript, session: `exec:${input.doEventId}` });

  // ---- call recording: sN.cK in call-start order, full uncapped results
  const raw = new WeakMap<CallCtx, unknown>();
  let tail: Promise<void> = Promise.resolve();
  const record = (name: string, fn: (args: Record<string, unknown>, ctx: CallCtx) => unknown) =>
    async (args: Record<string, unknown>, ctx: CallCtx): Promise<unknown> => {
      const prev = tail;
      let done!: () => void;
      tail = new Promise<void>((r) => (done = r));
      try {
        let result: unknown;
        try {
          result = await fn(args, ctx);
        } catch (e) {
          await prev;
          store.addCall(step, { tool: name, args, result: undefined, outcome: outcomeOf(undefined, errText(e)) });
          throw e;
        }
        await prev;
        const full = raw.has(ctx) ? raw.get(ctx) : result;
        store.addCall(step, { tool: name, args, result: full, outcome: outcomeOf(full) });
        return result;
      } finally {
        done();
      }
    };

  // ---- meta-tools
  const metaImpl = {
    async findTools(args: Record<string, unknown>): Promise<string> {
      const need = typeof args.need === "string" ? args.need.trim() : "";
      if (!need) throw new Error("findTools: `need` must be a non-empty string");
      const sel = await input.selector.select({ instruction: need, exclude: [...present.keys()], reporter: currentReporter() ?? reporter }, registry.decls);
      const added = sel.tools.filter((d) => !present.has(d.name)).slice(0, escalationLimit);
      escalations.push({ kind: "escalation", need, tools: added.map((d) => d.name) });
      if (!added.length) return "No other tools match that need.";
      await input.onAddTools?.(added);
      for (const d of added) present.set(d.name, d);
      return "Now callable:\n```ts\n" + declarations(added) + "\n```";
    },
    async resolve(args: Record<string, unknown>) {
      const lines = Array.isArray(args.lines) ? (args.lines as [number, number]) : undefined;
      return resolveRef(rctx, { ref: args.ref as string, grep: args.grep as string | undefined, lines });
    },
    async save(args: Record<string, unknown>): Promise<string> {
      const name = String(args.name);
      store.save({ name, value: args.value, summary: typeof args.summary === "string" ? args.summary : undefined }, step);
      return `@${name}`;
    },
    async refSymbol(args: Record<string, unknown>) {
      const file = String(args.file ?? args.path ?? "");
      const sym = args.name ?? args.symbol;
      const symbol = typeof sym === "string" && sym ? sym : undefined;
      if (!file) throw new RefError("invalid", "refSymbol: `file` is required");
      const ref = symbol ? `${file}#${symbol}` : file;
      // hash the same text `resolve` reads, so a later change shows up as stale
      const { text } = await resolveRef(rctx, { ref: `@${ref}`, maxChars: Infinity });
      return { ref, version: sha1(text) };
    },
  };

  /** Runs one `branch` program and returns the model-facing text. */
  const runProgram = async (args: Record<string, unknown>): Promise<string> => {
    const code = args.code;
    if (typeof code !== "string") return "branch: `code` must be a string";
    const mode = limits.branchContext ?? "trace";
    const program = compileBranch(code);
    const view = () => Object.fromEntries(store.names().map((n) => [n, store.getNamed(n).value]));
    if ("error" in program) {
      const fail: BranchFail = { ok: false, error: "compile", message: program.message, line: program.line, trace: [] };
      return renderTrace(fail, { mode, source: code, state: view() });
    }
    const scoped = currentReporter() ?? reporter;
    const bound = bindTools(registry, input.host, { reporter: scoped, names: [...present.keys()], outputCap: limits.outputCap, onRaw: (ctx, r) => raw.set(ctx, r) });
    const tools: BranchTools = {};
    for (const [n, fn] of Object.entries(bound)) tools[n] = record(n, fn);
    const meta = wrapTools(metaImpl, scoped);
    for (const [n, fn] of Object.entries(meta)) tools[n] = record(n, fn);

    // The program edits a plain copy; only keys it actually changed are written to the store,
    // so unchanged names are not re-versioned into this step and `save` calls survive write-back.
    const scratch: Record<string, unknown> = {};
    const before = new Map<string, string>();
    for (const n of store.names()) {
      const v = store.getNamed(n).value;
      scratch[n] = JSON.parse(JSON.stringify(v));
      before.set(n, JSON.stringify(v));
    }
    const result = await runBranch(program, tools, scratch, { signal: input.signal, timeoutMs: limits.timeoutMs, memoryMb: limits.memoryMb }, runtime);
    const notes: string[] = [];
    for (const [k, v] of Object.entries(scratch)) {
      if (before.get(k) === JSON.stringify(v)) continue;
      try {
        state[k] = v;
      } catch (e) {
        notes.push(`state.${k} was not kept: ${errText(e)}`);
      }
    }
    for (const k of before.keys()) if (!(k in scratch)) delete state[k];
    const text = renderTrace(result, { mode, source: code, state: view() });
    return notes.length ? `${text}\n${notes.join("\n")}` : text;
  };
  const branch = wrapTools({ branch: runProgram }, reporter).branch;

  // ---- loop (arch §5.2)
  let used = 0;
  let exhausted = false;
  const request = async (): Promise<AssistantMessage> => {
    used++;
    const body: Record<string, unknown> = { model: input.model, system, tools: [branchToolDef()], messages: [...messages], signal: input.signal };
    if (input.temperature !== undefined) body.temperature = input.temperature;
    const res = await llm.complete(body as Parameters<LLMClient["complete"]>[0]);
    const msg = ((res.response as { choices?: { message?: AssistantMessage }[] })?.choices?.[0]?.message ?? {}) as AssistantMessage;
    messages.push({ ...msg, role: "assistant" });
    return msg;
  };
  const textOf = (m: AssistantMessage) => (typeof m.content === "string" ? m.content.trim() : "");

  let report = "";
  for (;;) {
    if (used === cap - 1) messages.push({ role: "user", content: LAST_TURN_NOTICE });
    const msg = await request();
    const calls = msg.tool_calls ?? [];
    if (!calls.length) {
      report = textOf(msg);
      break;
    }
    if (used >= cap) {
      // out of turns and still calling tools: take whatever text came with the calls
      exhausted = true;
      report = textOf(msg);
      break;
    }
    for (const c of calls) {
      let content: string;
      if (c.function.name !== "branch") content = `unknown tool: ${c.function.name}; the only tool is \`branch\``;
      else {
        let args: Record<string, unknown> | undefined;
        try {
          args = JSON.parse(c.function.arguments || "{}") as Record<string, unknown>;
        } catch {
          args = undefined;
        }
        content = args ? await branch(args) : "branch: arguments are not valid JSON";
      }
      messages.push({ role: "tool", tool_call_id: c.id, content });
    }
  }
  if (!report) report = exhausted ? "(No report: the turn budget ran out before the executor reported.)" : "(The executor returned an empty report.)";

  // ---- finalise (arch §5.4)
  const changed = await input.tracker.end();
  const final = await finaliseReport({
    text: report,
    store,
    step,
    changed,
    exhausted,
    pathExists: input.pathExists,
    maxChars: limits.reportMaxChars,
    repair:
      used < cap
        ? async (message) => {
            messages.push({ role: "user", content: message });
            const text = textOf(await request());
            return text || undefined;
          }
        : undefined,
  });

  const handoff = buildHandoff({
    instruction: input.instruction,
    rendered,
    store,
    shortlist,
    stages: input.selection.stages,
    override: input.override,
    escalations,
    hotPaths: hotPaths.map((h) => h.id),
    budget: { turns: cap, used, exhausted },
    model: input.model,
  });
  return { report: final.text, changed, handoff, turns: used, exhausted };
}
