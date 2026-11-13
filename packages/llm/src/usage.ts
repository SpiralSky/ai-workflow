import type { CostSource, Usage } from "@aiw/telemetry";

/** API types with a usage normaliser (framework-runner §4.1). Only chat completions for now (A-24). */
export type APIType = "openai-chat";

/** Normalised usage of one response: tokens, plus cost and cache hit when the API reports them. */
export interface NormalisedUsage {
  usage: Usage;
  costUsd?: number;
  /** `api` whenever `costUsd` is set: this normaliser only records provider-reported cost. */
  costSource?: CostSource;
  cacheHit?: boolean;
}

/**
 * Normalises the usage block of a response body into one `Usage` record (telemetry §6).
 * Fields the API does not report are omitted, never estimated.
 * @param apiType - API the body came from
 * @param body - raw response body
 * @returns usage, plus `costUsd` with source `api` (OpenRouter `usage.cost`) and `cacheHit` when reported
 */
export function normaliseUsage(apiType: APIType, body: unknown): NormalisedUsage {
  if (apiType !== "openai-chat") throw new Error(`no usage normaliser for API type ${apiType}`);
  const u = (body as { usage?: Record<string, any> } | null)?.usage ?? {};
  const usage: Usage = { input: num(u.prompt_tokens) ?? 0, output: num(u.completion_tokens) ?? 0 };
  const cachedRead = num(u.prompt_tokens_details?.cached_tokens);
  if (cachedRead !== undefined) usage.cachedRead = cachedRead;
  const cacheWrite = num(u.prompt_tokens_details?.cache_write_tokens);
  if (cacheWrite !== undefined) usage.cacheWrite = cacheWrite;
  const out: NormalisedUsage = { usage };
  const cost = num(u.cost);
  if (cost !== undefined) { out.costUsd = cost; out.costSource = "api"; }
  if (cachedRead !== undefined) out.cacheHit = cachedRead > 0;
  return out;
}

const num = (v: unknown): number | undefined => (typeof v === "number" && Number.isFinite(v) ? v : undefined);
