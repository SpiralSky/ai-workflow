import type { NumericLLMClient, NumericLLMCompletion } from "@aiw/telemetry";
import { LLMError, classifyAPIError } from "./errors.ts";

/** Official tariff snapshot, not a measured bill or a guarantee of future pricing. */
export const DEEPSEEK_PRICE_BASIS = "deepseek-flash:2026-11-01:off-peak";
export const DEEPSEEK_ENDPOINT = "https://api.deepseek.com/chat/completions";
const MARGIN_MS = 5 * 60_000;

/** Conservative window: never assumes a Chinese holiday exemption. Returns safe milliseconds
 * until the next weekday peak, less a five-minute boundary margin; zero refuses admission. */
export function deepSeekOffPeakRemaining(now: number): number {
  if (!Number.isFinite(now)) return 0;
  const date = new Date(now);
  if (!Number.isFinite(date.getTime())) return 0;
  const midnight = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
  for (let day = 0; day <= 7; day++) {
    const start = midnight + day * 86_400_000;
    const weekday = new Date(start).getUTCDay();
    if (weekday === 0 || weekday === 6) continue;
    for (const [from, to] of [[1, 4], [6, 10]]) {
      const peakStart = start + from! * 3_600_000;
      const peakEnd = start + to! * 3_600_000;
      if (now >= peakStart - MARGIN_MS && now < peakEnd + MARGIN_MS) return 0;
      if (peakStart > now) return peakStart - MARGIN_MS - now;
    }
  }
  return 0;
}

export interface DeepSeekEstimate {
  basis: typeof DEEPSEEK_PRICE_BASIS;
  estimatedUsd: number;
  cacheHitTokens: number;
  cacheMissTokens: number;
  outputTokens: number;
}
export interface DeepSeekCompletion extends NumericLLMCompletion { deepseekEstimate: DeepSeekEstimate }

/** Validate complete provider token accounting. Absent/inconsistent tokens are not zero. */
export function deepSeekUsage(body: any): Pick<DeepSeekCompletion, "usage" | "cacheHit" | "deepseekEstimate"> {
  const u = body?.usage;
  const values = [u?.prompt_tokens, u?.completion_tokens, u?.prompt_cache_hit_tokens, u?.prompt_cache_miss_tokens];
  if (values.some(v => !Number.isSafeInteger(v) || v < 0) ||
      !Number.isSafeInteger(u.prompt_tokens + u.completion_tokens) ||
      u.prompt_cache_hit_tokens + u.prompt_cache_miss_tokens !== u.prompt_tokens ||
      (u.total_tokens !== undefined && u.total_tokens !== u.prompt_tokens + u.completion_tokens)) {
    throw new LLMError("infra", "DeepSeek usage missing or inconsistent");
  }
  return {
    usage: { input: u.prompt_tokens, output: u.completion_tokens, cachedRead: u.prompt_cache_hit_tokens },
    cacheHit: u.prompt_cache_hit_tokens > 0,
    deepseekEstimate: { basis: DEEPSEEK_PRICE_BASIS,
      estimatedUsd: (u.prompt_cache_hit_tokens * 0.003 + u.prompt_cache_miss_tokens * 0.15 + u.completion_tokens * 0.60) / 1e6,
      cacheHitTokens: u.prompt_cache_hit_tokens, cacheMissTokens: u.prompt_cache_miss_tokens, outputTokens: u.completion_tokens },
  };
}

/** Direct host-only client. No endpoint override, redirect, retry, paid fallback or peak dispatch.
 * Thinking history is forwarded intact; response messages retain reasoning_content for tool turns.
 * Timeout/abort is best effort: requests accepted by the provider may still incur charges. */
export function createDeepSeekClient(opts: { apiKey: string; fetch?: typeof fetch; now?: () => number; timeoutMs?: number }): NumericLLMClient {
  if (!opts.apiKey || /[\r\n]/.test(opts.apiKey)) throw new Error("DeepSeek API key required");
  const timeoutMs = opts.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2_147_483_647) throw new Error("Invalid DeepSeek timeout");
  return { async complete(req): Promise<DeepSeekCompletion> {
    if (req.model !== "deepseek-flash") throw new LLMError("other", "Unsupported direct DeepSeek model; select deepseek-flash");
    const caller = req.signal instanceof AbortSignal ? req.signal : undefined;
    if (caller?.aborted) throw new LLMError("infra", "DeepSeek request cancelled");
    const remaining = deepSeekOffPeakRemaining((opts.now ?? Date.now)());
    if (remaining <= timeoutMs) throw new LLMError("other", "DeepSeek off-peak admission closed; no request sent");
    for (const message of req.messages as any[]) {
      if (req.tools.length && message?.role === "assistant" && typeof message.reasoning_content !== "string") {
        throw new LLMError("other", "DeepSeek assistant thinking history is incomplete");
      }
    }
    const body = { model: req.model, messages: [{ role: "system", content: req.system }, ...req.messages],
      ...(req.tools.length ? { tools: req.tools } : {}), thinking: { type: "enabled" }, reasoning_effort: "high", stream: false };
    const signal = AbortSignal.any([...(caller ? [caller] : []), AbortSignal.timeout(timeoutMs)]);
    let response: Response;
    let json: any;
    try {
      response = await (opts.fetch ?? fetch)(DEEPSEEK_ENDPOINT, { method: "POST", redirect: "error", signal,
        headers: { authorization: `Bearer ${opts.apiKey}`, "content-type": "application/json" }, body: JSON.stringify(body) });
      signal.throwIfAborted();
      const text = await response.text();
      signal.throwIfAborted();
      try { json = JSON.parse(text); } catch { throw new LLMError(response.ok ? "infra" : classifyAPIError(response.status, text), "DeepSeek invalid response", response.status); }
    } catch (error) {
      if (caller?.aborted) throw new LLMError("infra", "DeepSeek request cancelled");
      if (error instanceof LLMError) throw error;
      throw new LLMError("infra", "DeepSeek transport failed");
    }
    if (!response.ok || json?.error) throw new LLMError(classifyAPIError(response.status, String(json?.error?.message ?? "")), "DeepSeek request rejected", response.status);
    const choice = json?.choices?.[0];
    const message = choice?.message;
    if (!message || typeof message.reasoning_content !== "string" ||
        (choice.finish_reason !== "stop" && choice.finish_reason !== "tool_calls") ||
        (!message.content && !message.tool_calls?.length)) throw new LLMError("infra", "DeepSeek incomplete response");
    return { response: json, ...deepSeekUsage(json) };
  } };
}
