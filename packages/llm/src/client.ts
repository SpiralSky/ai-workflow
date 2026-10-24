import type { LLMClient, LLMCompletion } from "@aiw/telemetry";
import { LLMError, classifyAPIError } from "./errors.ts";
import { normaliseUsage } from "./usage.ts";

/** Options for an OpenAI-compatible chat-completions client. */
export interface ChatClientOptions {
  /** API base URL, e.g. `https://openrouter.ai/api/v1`. */
  baseURL: string;
  apiKey: string;
  /** Per-request timeout; a timeout is an infra error. Default 300 s. */
  timeoutMs?: number;
  /** Injected for tests. */
  fetch?: typeof fetch;
}

/**
 * Creates an OpenAI-compatible chat-completions client implementing telemetry's `LLMClient`.
 * The request's `system` becomes the first message; `tools` are sent as given (function schemas)
 * and omitted when empty; any other request key (e.g. `temperature`) is passed through in the
 * body, except `signal`, which aborts the request. On OpenRouter the client asks for usage
 * accounting so the response carries `usage.cost` (A-24).
 * @param opts - endpoint, key and timeout
 * @returns client whose `complete()` returns the raw response body with normalised usage
 * @throws LLMError from `complete()`, classified per runner §4.4
 */
export function createChatClient(opts: ChatClientOptions): LLMClient {
  const url = `${opts.baseURL.replace(/\/+$/, "")}/chat/completions`;
  const openRouter = /openrouter\.ai/.test(opts.baseURL);
  const doFetch = opts.fetch ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 300_000;

  return {
    async complete(req): Promise<LLMCompletion> {
      const { system, tools, messages, signal, ...rest } = req;
      const body: Record<string, unknown> = {
        ...rest,
        messages: [{ role: "system", content: system }, ...messages],
      };
      if (tools.length > 0) body.tools = tools;
      if (openRouter) body.usage = { include: true };

      const timeout = AbortSignal.timeout(timeoutMs);
      const abort = signal instanceof AbortSignal ? AbortSignal.any([signal, timeout]) : timeout;
      let res: Response;
      let text: string;
      try {
        res = await doFetch(url, {
          method: "POST",
          headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: abort,
        });
        text = await res.text();
      } catch (e) {
        // A caller's abort is not an infra error; rethrow it unchanged.
        if (signal instanceof AbortSignal && signal.aborted) throw e;
        throw new LLMError("infra", `request failed: ${(e as Error).message}`);
      }

      let json: any;
      try {
        json = JSON.parse(text);
      } catch {
        const kind = res.ok ? "infra" : classifyAPIError(res.status, text);
        throw new LLMError(kind, `HTTP ${res.status}: unparseable body: ${text.slice(0, 300)}`, res.status);
      }
      // OpenRouter can report upstream errors in a 200 body.
      if (!res.ok || json?.error) {
        const message = String(json?.error?.message ?? text).slice(0, 500);
        const status = res.ok ? numericCode(json?.error?.code) : res.status;
        throw new LLMError(classifyAPIError(status, message), `HTTP ${res.status}: ${message}`, status);
      }

      const choice = json?.choices?.[0];
      if (choice?.finish_reason === "content_filter") {
        throw new LLMError("infra", "response was content-filtered", res.status);
      }
      const msg = choice?.message;
      if (!msg || (!msg.content && !msg.tool_calls?.length)) {
        throw new LLMError("infra", `empty response: ${text.slice(0, 300)}`, res.status);
      }
      return { response: json, ...normaliseUsage("openai-chat", json) };
    },
  };
}

const numericCode = (c: unknown): number | undefined => (typeof c === "number" ? c : undefined);
