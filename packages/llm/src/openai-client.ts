import type { LLMClient, LLMCompletion } from "@aiw/telemetry";
import { LLMError, classifyAPIError } from "./errors.ts";
import { tableCost } from "./prices.ts";

/** The only model id the direct client sends; also the base of its price-table keys. */
export const OPENAI_MODEL = "gpt-6-luna";
export const OPENAI_ENDPOINT = "https://api.openai.com/v1/chat/completions";

/**
 * Validates complete provider token accounting and prices it by the service tier the response
 * reports (`flex` -> `gpt-6-luna@flex`, `default` -> `gpt-6-luna`). A missing or other tier yields
 * no cost fields, so the cost meter marks the run cost-incomplete; Flex is never assumed.
 * @param body - OpenAI chat-completions response body
 * @throws LLMError (infra) when usage is missing or inconsistent
 */
export function openAIUsage(body: any): Pick<LLMCompletion, "usage" | "cacheHit" | "costUsd" | "costSource" | "priceTable"> {
  const u = body?.usage;
  const values = [u?.prompt_tokens, u?.completion_tokens, u?.prompt_tokens_details?.cached_tokens];
  if (values.some(v => !Number.isSafeInteger(v) || v < 0) ||
      !Number.isSafeInteger(u.prompt_tokens + u.completion_tokens) ||
      u.prompt_tokens_details.cached_tokens > u.prompt_tokens ||
      (u.total_tokens !== undefined && u.total_tokens !== u.prompt_tokens + u.completion_tokens)) {
    throw new LLMError("infra", "OpenAI usage missing or inconsistent");
  }
  const cached = u.prompt_tokens_details.cached_tokens;
  const usage = { input: u.prompt_tokens, output: u.completion_tokens, cachedRead: cached };
  const tier = body?.service_tier;
  const key = tier === "flex" ? `${OPENAI_MODEL}@flex` : tier === "default" ? OPENAI_MODEL : undefined;
  return { usage, cacheHit: cached > 0, ...(key ? tableCost(key, usage) : {}) };
}

/** Direct host-only client for gpt-6-luna on the Flex tier. No endpoint override, redirect or retry.
 * A 429 (including Resource Unavailable) surfaces as an infra error; the caller decides what to do.
 * Timeout/abort is best effort: requests accepted by the provider may still incur charges. */
export function createOpenAIClient(opts: { apiKey: string; fetch?: typeof fetch; timeoutMs?: number }): LLMClient {
  if (!opts.apiKey || /[\r\n]/.test(opts.apiKey)) throw new Error("OpenAI API key required");
  const timeoutMs = opts.timeoutMs ?? 900_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new Error("Invalid OpenAI timeout");
  return { async complete(req): Promise<LLMCompletion> {
    if (req.model !== OPENAI_MODEL) throw new LLMError("other", "Unsupported direct OpenAI model; select gpt-6-luna");
    const caller = req.signal instanceof AbortSignal ? req.signal : undefined;
    if (caller?.aborted) throw new LLMError("infra", "OpenAI request cancelled");
    const body = { model: req.model, messages: [{ role: "system", content: req.system }, ...req.messages],
      ...(req.tools.length ? { tools: req.tools } : {}), service_tier: "flex", stream: false };
    const signal = AbortSignal.any([...(caller ? [caller] : []), AbortSignal.timeout(timeoutMs)]);
    let response: Response;
    let json: any;
    try {
      response = await (opts.fetch ?? fetch)(OPENAI_ENDPOINT, { method: "POST", redirect: "error", signal,
        headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      signal.throwIfAborted();
      const text = await response.text();
      signal.throwIfAborted();
      try { json = JSON.parse(text); } catch { throw new LLMError(response.ok ? "infra" : classifyAPIError(response.status, text), "OpenAI invalid response", response.status); }
    } catch (error) {
      if (caller?.aborted) throw new LLMError("infra", "OpenAI request cancelled");
      if (error instanceof LLMError) throw error;
      throw new LLMError("infra", "OpenAI transport failed");
    }
    if (!response.ok || json?.error) throw new LLMError(classifyAPIError(response.status, String(json?.error?.message ?? "")), "OpenAI request rejected", response.status);
    const choice = json?.choices?.[0];
    const message = choice?.message;
    if (!message || (choice.finish_reason !== "stop" && choice.finish_reason !== "tool_calls") ||
        (!message.content && !message.tool_calls?.length)) throw new LLMError("infra", "OpenAI incomplete response");
    return { response: json, ...openAIUsage(json) };
  } };
}
