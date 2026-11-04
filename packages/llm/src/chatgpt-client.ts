import type { NumericLLMClient, NumericLLMCompletion } from "@aiw/telemetry";
import { LLMError, classifyAPIError } from "./errors.ts";

/** Only public SIWC endpoints are supported. OAuth credentials never follow redirects. */
const API = "https://api.openai.com/v1";
const NAMESPACE = "ai_workflow";
const MAX_EVENT_BYTES = 16 * 1024 * 1024;
type RecordValue = Record<string, any>;

/** Credential lookup is deliberately separate from benchmark inputs and provenance. */
export interface ChatGPTClientOptions {
  accessToken: (signal?: AbortSignal) => Promise<string>;
  timeoutMs?: number;
  /** Inject a transport only for offline tests. */
  fetch?: typeof fetch;
}

/** A visible account-specific model; the slug, not its display label, goes into inference. */
export interface ChatGPTModel { slug: string; display_name: string }

/** Fetch the current account catalog without caching across account switches. */
export async function listChatGPTModels(opts: ChatGPTClientOptions, signal?: AbortSignal): Promise<ChatGPTModel[]> {
  const abort = requestSignal(opts, signal);
  try {
    abort.throwIfAborted();
    const token = await opts.accessToken(abort);
    abort.throwIfAborted();
    const res = await (opts.fetch ?? fetch)(`${API}/models`, {
      headers: { authorization: `Bearer ${token}` }, redirect: "error", signal: abort,
    });
    if (!res.ok) throw await httpError(res);
    const json = await res.json() as RecordValue;
    abort.throwIfAborted();
    if (!Array.isArray(json.models)) throw new LLMError("infra", "ChatGPT model catalog is malformed");
    return json.models.filter((m: RecordValue) => m?.visibility === "list")
      .map((m: RecordValue) => {
        if (typeof m.slug !== "string" || !m.slug || typeof m.display_name !== "string") {
          throw new LLMError("infra", "ChatGPT model catalog is malformed");
        }
        return { slug: m.slug, display_name: m.display_name };
      });
  } catch (e) { throw safeError(e, signal); }
}

/**
 * Adapt the framework's chat contract to stateless SIWC Responses HTTP/SSE.
 * No SDK retries, paid fallback, arbitrary base URL, or unsupported preview fields.
 * `responses_output` on the assistant message must be retained by callers as history.
 */
export function createChatGPTClient(opts: ChatGPTClientOptions): NumericLLMClient {
  return {
    async complete(req): Promise<NumericLLMCompletion> {
      const signal = req.signal instanceof AbortSignal ? req.signal : undefined;
      const abort = requestSignal(opts, signal);
      try {
        abort.throwIfAborted();
        const body = {
          model: req.model,
          instructions: req.system,
          input: mapHistory(req.messages),
          ...(req.tools.length ? { tools: mapTools(req.tools) } : {}),
          store: false,
          stream: true,
        };
        const token = await opts.accessToken(abort);
        abort.throwIfAborted();
        const res = await (opts.fetch ?? fetch)(`${API}/responses`, {
          method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
          redirect: "error", signal: abort, body: JSON.stringify(body),
        });
        if (!res.ok) throw await httpError(res);
        if (!res.body || !res.headers.get("content-type")?.includes("text/event-stream")) {
          throw new LLMError("infra", "ChatGPT response is not an event stream");
        }
        const completed = await readCompleted(res.body, abort);
        return mapCompletion(completed);
      } catch (e) { throw safeError(e, signal); }
    },
  };
}

/** Preserve full reasoning/message/function-call output rather than reconstructing lossy history. */
function mapHistory(messages: unknown[]): unknown[] {
  const input: unknown[] = [];
  for (const raw of messages) {
    const m = object(raw);
    if (m.role === "assistant" && Array.isArray(m.responses_output)) {
      for (const item of m.responses_output) {
        const o = object(item);
        if (!["message", "reasoning", "function_call"].includes(o.type) || (o.type === "message" && o.role !== "assistant")) {
          throw new LLMError("other", "Unsupported Responses history item");
        }
        input.push(item);
      }
    } else if (m.role === "tool") {
      if (typeof m.tool_call_id !== "string" || typeof m.content !== "string") throw new LLMError("other", "Invalid tool result history");
      input.push({ type: "function_call_output", call_id: m.tool_call_id, output: m.content });
    } else if (["user", "assistant", "developer", "system"].includes(m.role)) {
      if (m.content !== undefined && m.content !== null && m.content !== "") {
        if (typeof m.content !== "string") throw new LLMError("other", "Only text chat history is supported");
        input.push({ role: m.role === "system" ? "developer" : m.role, content: m.content });
      }
      if (Array.isArray(m.tool_calls)) {
        for (const call of m.tool_calls) {
          if (m.role !== "assistant" || typeof call.id !== "string" || typeof call.function?.name !== "string" || typeof call.function?.arguments !== "string") {
            throw new LLMError("other", "Invalid function call history");
          }
          input.push({ type: "function_call", call_id: call.id, namespace: NAMESPACE, name: call.function.name, arguments: call.function.arguments });
        }
      }
    } else throw new LLMError("other", "Unsupported chat history role");
  }
  return input;
}

/** Existing framework tools are functions; no hosted tool or tool_search is enabled. */
function mapTools(tools: unknown[]): unknown[] {
  const names = new Set<string>();
  const functions = tools.map(raw => {
    const t = object(raw), f = object(t.function);
    if (t.type !== "function" || typeof f.name !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(f.name) || names.has(f.name)) {
      throw new LLMError("other", "Invalid or unsupported ChatGPT tool definition");
    }
    names.add(f.name);
    return { type: "function", name: f.name, ...(typeof f.description === "string" ? { description: f.description } : {}),
      parameters: f.parameters ?? { type: "object", properties: {} }, strict: f.strict === true };
  });
  return [{ type: "namespace", name: NAMESPACE, description: "AI Workflow client-executed tools", tools: functions }];
}

/** Consume through the terminal event; deltas and EOF alone never establish success. */
async function readCompleted(stream: ReadableStream<Uint8Array>, signal: AbortSignal): Promise<RecordValue> {
  const reader = stream.getReader();
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let pending = "", data: string[] = [], eventBytes = 0;
  let doneResponse: RecordValue | undefined;
  const abortReader = () => { void reader.cancel().catch(() => {}); };
  signal.addEventListener("abort", abortReader, { once: true });
  /** Parse one SSE event, accepting multiline data and comment heartbeats. */
  const dispatch = () => {
    if (!data.length) return;
    const payload = data.join("\n"); data = []; eventBytes = 0;
    if (payload === "[DONE]") {
      if (!doneResponse) throw new LLMError("infra", "ChatGPT stream ended without response.completed");
      return;
    }
    let event: RecordValue;
    try { event = object(JSON.parse(payload)); } catch { throw new LLMError("infra", "Malformed ChatGPT stream event"); }
    if (event.type === "response.failed" || event.type === "response.incomplete" || event.type === "error") {
      const code = event.response?.error?.code ?? event.error?.code ?? event.code;
      // Only known public codes are emitted. Never echo arbitrary provider messages or bodies.
      const reason = ["subscription_sharing_usage_limit_exceeded", "subscription_sharing_usage_unavailable", "context_length_exceeded"].includes(code) ? ` (${code})` : "";
      throw new LLMError(code === "context_length_exceeded" ? "context-limit" : "infra", `ChatGPT inference did not complete${reason}`);
    }
    if (event.type === "response.completed") {
      if (doneResponse || event.response?.status !== "completed") throw new LLMError("infra", "Invalid ChatGPT completion event");
      doneResponse = object(event.response);
    }
  };
  try {
    while (true) {
      signal.throwIfAborted();
      const { value, done } = await reader.read();
      signal.throwIfAborted();
      pending += done ? decoder.decode() : decoder.decode(value, { stream: true });
      if (pending.length + eventBytes > MAX_EVENT_BYTES) throw new LLMError("infra", "ChatGPT stream event exceeds size limit");
      let newline: number;
      while ((newline = pending.indexOf("\n")) >= 0) {
        let line = pending.slice(0, newline); pending = pending.slice(newline + 1);
        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (!line) dispatch();
        else if (line.startsWith("data:")) {
          const piece = line.slice(5).replace(/^ /, ""); data.push(piece); eventBytes += piece.length;
        }
        if (doneResponse) return doneResponse;
      }
      if (done) break;
    }
    throw new LLMError("infra", "ChatGPT stream ended without response.completed");
  } finally {
    signal.removeEventListener("abort", abortReader);
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

/** Keep raw output for replay and expose the chat facade expected by existing agents. */
function mapCompletion(response: RecordValue): NumericLLMCompletion {
  if (!Array.isArray(response.output)) throw new LLMError("infra", "Malformed ChatGPT completion output");
  let content = "";
  const toolCalls: unknown[] = [];
  for (const raw of response.output) {
    const item = object(raw);
    if (item.type === "message") {
      if (item.role !== "assistant" || !Array.isArray(item.content)) throw new LLMError("infra", "Malformed ChatGPT message");
      for (const part of item.content) {
        if (part.type === "output_text" && typeof part.text === "string") content += part.text;
        else if (part.type === "refusal" && typeof part.refusal === "string") content += part.refusal;
        else throw new LLMError("infra", "Unsupported ChatGPT message output");
      }
    } else if (item.type === "function_call") {
      if (typeof item.call_id !== "string" || typeof item.name !== "string" || typeof item.arguments !== "string" ||
        (item.namespace !== undefined && item.namespace !== NAMESPACE)) throw new LLMError("infra", "Malformed ChatGPT function call");
      toolCalls.push({ id: item.call_id, type: "function", function: { name: item.name, arguments: item.arguments } });
    } else if (item.type !== "reasoning") throw new LLMError("infra", "Unsupported ChatGPT response output");
  }
  if (!content && !toolCalls.length) throw new LLMError("infra", "Empty ChatGPT completion");
  const u = response.usage;
  if (!validCount(u?.input_tokens) || !validCount(u?.output_tokens)) throw new LLMError("infra", "Missing ChatGPT token usage");
  const cached = u.input_tokens_details?.cached_tokens;
  if (cached !== undefined && (!validCount(cached) || cached > u.input_tokens)) throw new LLMError("infra", "Invalid ChatGPT cached usage");
  const message = { role: "assistant", content, ...(toolCalls.length ? { tool_calls: toolCalls } : {}), responses_output: response.output };
  return {
    response: { id: response.id, model: response.model, choices: [{ message, finish_reason: toolCalls.length ? "tool_calls" : "stop" }] },
    usage: { input: u.input_tokens, output: u.output_tokens, ...(cached !== undefined ? { cachedRead: cached } : {}) },
    ...(cached !== undefined ? { cacheHit: cached > 0 } : {}),
    // Subscription usage has no measured per-request USD price. Never invent costUsd: 0.
  };
}

/** Require an object without echoing malformed (possibly sensitive) inputs. */
function object(value: unknown): RecordValue {
  if (value === null || typeof value !== "object" || Array.isArray(value)) throw new LLMError("other", "Expected an object");
  return value as RecordValue;
}
/** Token counts must be known non-negative integers for subscription bounds. */
function validCount(value: unknown): value is number { return typeof value === "number" && Number.isSafeInteger(value) && value >= 0; }
/** Bound credential lookup and transport by the caller's cancellation and request timeout. */
function requestSignal(opts: ChatGPTClientOptions, signal?: AbortSignal): AbortSignal {
  const timeout = AbortSignal.timeout(opts.timeoutMs ?? 300_000);
  return signal ? AbortSignal.any([signal, timeout]) : timeout;
}
/** Never include upstream bodies, headers, or transport exception messages in telemetry. */
async function httpError(response: Response): Promise<LLMError> {
  let code: unknown;
  try { code = (await response.json() as RecordValue)?.error?.code; } catch { /* Non-JSON errors remain status-only. */ }
  const context = code === "context_length_exceeded";
  const quota = code === "subscription_sharing_usage_limit_exceeded" || code === "subscription_sharing_usage_unavailable";
  return new LLMError(context ? "context-limit" : classifyAPIError(response.status, ""),
    `ChatGPT HTTP ${response.status}${context || quota ? ` (${code})` : ""}`, response.status);
}
/** Preserve caller cancellation and our safe errors, sanitize all other exceptions. */
function safeError(error: unknown, signal?: AbortSignal): unknown {
  if (signal?.aborted) return signal.reason;
  return error instanceof LLMError ? error : new LLMError("infra", "ChatGPT request failed");
}
