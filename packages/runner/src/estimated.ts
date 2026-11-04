import { assertNumericCompletion, type LLMClient } from "@aiw/telemetry";
import { DEEPSEEK_PRICE_BASIS, LLMError } from "@aiw/llm";
import { boundSubscriptionClient, type SubscriptionLimits, type SubscriptionUsage } from "./subscription.ts";

export interface EstimatedLimits extends SubscriptionLimits { estimateLimitUsd: number }
export interface EstimatedUsage extends SubscriptionUsage {
  costBasis: "price-table-estimate";
  priceBasis: typeof DEEPSEEK_PRICE_BASIS;
  estimatedUsd: number | null;
  knownEstimatedUsd: number;
  cacheMissTokens: number;
}
/** Shared serial admission and post-response estimate threshold, NOT a hard monetary cap.
 * Includes every main/selection/secondary call; failure poisons subsequent admission. */
export function boundEstimatedClient(client: LLMClient, limits: EstimatedLimits) {
  if (!Number.isFinite(limits.estimateLimitUsd) || limits.estimateLimitUsd <= 0) throw new Error("An explicit positive estimate limit is required");
  let estimate = 0, misses = 0;
  const bounded = boundSubscriptionClient({ async complete(request) {
    if (estimate >= limits.estimateLimitUsd) throw new LLMError("other", "estimated-cost-threshold");
    const completion = await client.complete(request);
    assertNumericCompletion(completion);
    const e = completion.deepseekEstimate;
    if (!e || e.basis !== DEEPSEEK_PRICE_BASIS || !Number.isFinite(e.estimatedUsd) || e.estimatedUsd < 0 ||
        !Number.isSafeInteger(e.cacheMissTokens) || e.cacheMissTokens < 0 || completion.costUsd !== undefined) {
      throw new LLMError("infra", "DeepSeek estimate accounting unavailable");
    }
    estimate += e.estimatedUsd;
    misses += e.cacheMissTokens;
    return completion;
  } }, limits);
  return {
    client: bounded.client,
    stopReason: () => estimate >= limits.estimateLimitUsd ? "estimated-cost-threshold" : bounded.stopReason()?.replace(/^subscription-/, "estimated-"),
    snapshot: (): EstimatedUsage => {
      const usage = bounded.snapshot();
      return { ...usage, costBasis: "price-table-estimate", priceBasis: DEEPSEEK_PRICE_BASIS,
        estimatedUsd: usage.incomplete ? null : estimate, knownEstimatedUsd: estimate, cacheMissTokens: misses };
    },
  };
}
