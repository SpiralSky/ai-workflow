/**
 * Main-session model loop for one job attempt.
 * Runner architecture §4.2, §4.3.
 */

import { wrapLLM } from "@aiw/telemetry";
import { LLMError } from "@aiw/llm";
import type { LLMClient } from "@aiw/telemetry";
import type { Reporter } from "@aiw/telemetry";
import type { MCPSession } from "./mcp.ts";
import { callTool } from "./mcp.ts";

/** Metrics produced by the model loop. */
export interface LoopMetrics {
  turns: number;
  toolCalls: number;
  costUsd: number | null;
  costIncompleteReasons?: string[];
}

/** Result of a model loop execution. */
export interface LoopResult {
  outcome: "done" | "turn-limit" | "context-limit" | "infra-error";
  metrics: LoopMetrics;
  infraError?: string;
}

/** Options for the model loop. */
export interface LoopOptions {
  client: LLMClient;
  reporter: Reporter;
  session: MCPSession;
  /** Combined system prompt (base + framework instructions). */
  systemPrompt: string;
  /** The problem's task.md verbatim. */
  taskText: string;
  model: string;
  temperature: number;
  /** Maximum main turns allowed (from task.json). */
  turnLimit: number;
  /** Framework variant (for sequential vs concurrent tool dispatch, §4.3). */
  framework: string;
  /** AbortSignal for budget cancellation. */
  signal?: AbortSignal;
  /** Stop the campaign immediately, before other tool calls or cleanup settle. */
  onInfraError?: () => void;
}

/** Converts MCP tool list to OpenAI function-call schemas. */
function mcpToolsToSchemas(tools: MCPSession["tools"]): unknown[] {
  return tools.map((t) => ({
    type: "function",
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));
}

/** True for catalog-only (baseline) frameworks, which execute tool calls sequentially. */
function isCatalogOnly(framework: string): boolean {
  const base = framework.split("[")[0] ?? framework;
  return base === "baseline";
}

/**
 * Appends `[tool time: N ms]` to the tool result text per A-09.
 * @param text - original result text
 * @param durationMs - execution time in milliseconds
 */
function withTiming(text: string, durationMs: number): string {
  return `${text}\n[tool time: ${durationMs} ms]`;
}

/**
 * Dispatches one batch of tool calls (one turn's worth).
 * Catalog tools execute sequentially; framework tools concurrently (§4.3, A-25).
 * @param calls - tool call objects from the model response
 * @param session - MCP session
 * @param reporter - reporter for tool events
 * @param framework - framework variant for sequencing decision
 * @returns tool result messages and total cost incurred
 */
async function dispatchToolCalls(
  calls: Array<{ id: string; function: { name: string; arguments: string } }>,
  session: MCPSession,
  reporter: Reporter,
  framework: string,
  signal?: AbortSignal,
  onInfraError?: () => void,
): Promise<{ messages: unknown[]; totalCost: number; costIncomplete: boolean; infraError?: string }> {
  const sequential = isCatalogOnly(framework);
  const messages: unknown[] = [];
  let totalCost = 0;
  let costIncomplete = false;
  let infraError: string | undefined;

  async function dispatch(call: { id: string; function: { name: string; arguments: string } }) {
    signal?.throwIfAborted();
    let args: Record<string, unknown>;
    try {
      args = JSON.parse(call.function.arguments);
    } catch {
      args = {};
    }

    const eventId = reporter.newId();
    reporter.toolStart({ id: eventId, name: call.function.name, args, harnessId: call.id });

    const startTs = Date.now();
    const meta = { "aiw/parent": eventId, "aiw/harnessId": call.id };
    let result: import("./mcp.ts").MCPCallResult;
    let ok = true;
    let errorMsg: string | undefined;

    try {
      result = await callTool(session, call.function.name, args, meta, signal);
    } catch (e) {
      ok = false;
      errorMsg = e instanceof Error ? e.message : String(e);
      result = { content: [{ type: "text", text: `Error: ${errorMsg}` }], durationMs: 0 };
    }

    if (!ok || result.infraError) {
      infraError ??= errorMsg ?? result.infraError ?? "MCP request failed";
      onInfraError?.();
    }
    // Only `do` can hide nested model work; ordinary catalog/tool errors are not charges.
    if (framework.split("[")[0] === "orchestrate" && call.function.name === "do" && (!ok || result.isError || result.infraError)) {
      costIncomplete = true;
      onInfraError?.();
    }
    const durationMs = result.durationMs ?? (Date.now() - startTs);
    reporter.tool({
      id: eventId,
      name: call.function.name,
      args,
      ok,
      error: errorMsg,
      durationMs,
      startTs,
      resultBytes: JSON.stringify(result.content).length,
      harnessId: call.id,
    });

    const text = result.content.map((c) => c.text).join("\n");
    messages.push({
      role: "tool",
      tool_call_id: call.id,
      content: withTiming(text, durationMs),
    });
  }

  if (sequential) {
    for (const call of calls) await dispatch(call);
  } else {
    await Promise.all(calls.map((call) => dispatch(call)));
    // Sort results to match call order for the message array
    // (Promise.all preserves order, so messages are already ordered)
  }

  return { messages, totalCost, costIncomplete, infraError };
}

/**
 * Runs the main model loop for one job attempt.
 * Returns when the model stops calling tools, reaches the turn limit, or hits an error.
 * @param opts - loop configuration
 * @returns loop outcome and aggregated metrics
 */
export async function runLoop(opts: LoopOptions): Promise<LoopResult> {
  const wrappedClient = wrapLLM(opts.client, opts.reporter, "main");
  const tools = mcpToolsToSchemas(opts.session.tools);
  const messages: unknown[] = [{ role: "user", content: opts.taskText }];

  let turns = 0;
  let toolCalls = 0;
  let costUsd: number | null = 0;
  const costIncompleteReasons: string[] = [];

  while (true) {
    if (opts.signal?.aborted) {
      return { outcome: "infra-error", metrics: { turns, toolCalls, costUsd, costIncompleteReasons }, infraError: "cancelled" };
    }
    if (turns >= opts.turnLimit) {
      return { outcome: "turn-limit", metrics: { turns, toolCalls, costUsd, costIncompleteReasons } };
    }

    let completion: import("@aiw/telemetry").LLMCompletion;
    try {
      completion = await wrappedClient.complete({
        model: opts.model,
        system: opts.systemPrompt,
        tools,
        messages,
        temperature: opts.temperature,
        signal: opts.signal,
      });
    } catch (e) {
      costIncompleteReasons.push("unobserved-failed-model-request");
      opts.onInfraError?.();
      if (e instanceof LLMError) {
        if (e.kind === "context-limit") {
          return { outcome: "context-limit", metrics: { turns, toolCalls, costUsd, costIncompleteReasons } };
        }
        // infra errors bubble to job.ts for retry
        return { outcome: "infra-error", metrics: { turns, toolCalls, costUsd, costIncompleteReasons }, infraError: e.message };
      }
      throw e;
    }

    turns++;
    costUsd = costUsd === null || completion.costUsd === undefined || !Number.isFinite(completion.costUsd) || completion.costUsd < 0
      ? null : costUsd + completion.costUsd;

    const response = completion.response as {
      choices?: Array<{ message?: { reasoning_content?: string; responses_output?: unknown[]; content?: string; tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }> } }>;
    };
    const msg = response?.choices?.[0]?.message;
    if (!msg) break;

    const assistantMessage: Record<string, unknown> = { role: "assistant" };
    if (msg.content) assistantMessage.content = msg.content;
    if (msg.tool_calls?.length) assistantMessage.tool_calls = msg.tool_calls;
    if (msg.responses_output) assistantMessage.responses_output = msg.responses_output;
    if (typeof msg.reasoning_content === "string") assistantMessage.reasoning_content = msg.reasoning_content;
    messages.push(assistantMessage);

    if (!msg.tool_calls?.length) {
      // No tool calls — model is done
      break;
    }

    toolCalls += msg.tool_calls.length;
    const { messages: toolMessages, costIncomplete, infraError } = await dispatchToolCalls(
      msg.tool_calls,
      opts.session,
      opts.reporter,
      opts.framework,
      opts.signal,
      opts.onInfraError,
    );
    if (costIncomplete) {
      costIncompleteReasons.push("failed-tool-may-have-unobserved-charges");
      return { outcome: "infra-error", metrics: { turns, toolCalls, costUsd, costIncompleteReasons }, infraError: "nested model tool failed; campaign requires diagnosis" };
    }
    if (infraError) return { outcome: "infra-error", metrics: { turns, toolCalls, costUsd, costIncompleteReasons }, infraError };
    messages.push(...toolMessages);
  }

  return { outcome: "done", metrics: { turns, toolCalls, costUsd, costIncompleteReasons } };
}
