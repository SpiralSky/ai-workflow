import { TYPESAFE_PRICE_BASIS, TYPESAFE_MODEL, LLMError, validateDecisionsRequest, type DecisionsClient } from "@aiw/llm";
import { validateSubscriptionLimits } from "./subscription.ts";
import type { EstimatedLimits } from "./estimated.ts";

export interface ClassifierEstimatedUsage {
  calls: number;
  completedCalls: number;
  inputTokens: number;
  outputTokens: number;
  elapsedMs: number;
  incomplete: boolean;
  costBasis: "price-table-estimate";
  priceBasis: typeof TYPESAFE_PRICE_BASIS;
  estimatedUsd: number | null;
  knownEstimatedUsd: number;
}
/** Campaign-wide serial direct classifier gate. Limits never reset at job/attempt boundaries.
 * Observed tokens/estimated dollars stop future admission, not a hard cap on the last request.
 * Parseable failed responses retain observed token/estimate accounting before the workflow stops. */
export function boundClassifierEstimatedClient(client: DecisionsClient, limits: EstimatedLimits) {
  validateSubscriptionLimits(limits);
  if (!Number.isFinite(limits.estimateLimitUsd) || limits.estimateLimitUsd <= 0) throw new Error("Classifier estimate limit must be positive");
  const start = Date.now();
  const deadline = AbortSignal.timeout(limits.maxDurationMs);
  const usage: ClassifierEstimatedUsage = { calls: 0, completedCalls: 0, inputTokens: 0, outputTokens: 0, elapsedMs: 0, incomplete: false,
    costBasis: "price-table-estimate", priceBasis: TYPESAFE_PRICE_BASIS, estimatedUsd: 0, knownEstimatedUsd: 0 };
  let stopped: string | undefined;
  let queue = Promise.resolve();
  const stopReason = () => stopped ?? (deadline.aborted ? "classifier-time-limit" : usage.calls >= limits.maxCalls ? "classifier-call-limit" :
    usage.inputTokens + usage.outputTokens >= limits.maxTokens ? "classifier-token-limit" : usage.knownEstimatedUsd >= limits.estimateLimitUsd ? "classifier-estimate-limit" : undefined);
  return {
    snapshot: (): ClassifierEstimatedUsage => ({ ...usage, estimatedUsd: usage.incomplete ? null : usage.knownEstimatedUsd, elapsedMs: Date.now() - start }), stopReason,
    client: { async classify(req) {
      validateDecisionsRequest(req);
      let release!: () => void;
      const predecessor = queue; queue = new Promise<void>(resolve => { release = resolve; });
      try {
        await predecessor;
        const reason = stopReason();
        if (reason) throw new LLMError("infra", reason);
        const signal = AbortSignal.any([deadline, ...(req.signal ? [req.signal] : [])]);
        if (signal.aborted) throw new LLMError("infra", "Classifier request cancelled");
        usage.calls++;
        try {
          const result = await client.classify({ ...req, signal });
          const tokens = result.usage, estimate = result.classifierEstimate;
          const valid = tokens && Number.isSafeInteger(tokens.input) && tokens.input >= 0 && Number.isSafeInteger(tokens.output) && tokens.output >= 0 &&
            estimate?.basis === TYPESAFE_PRICE_BASIS && estimate.inputTokens === tokens.input && estimate.outputTokens === tokens.output &&
            estimate.estimatedUsd === tokens.input * 0.042 / 1e6 && Number.isFinite(estimate.estimatedUsd) && estimate.estimatedUsd >= 0 &&
            result.providerModel === TYPESAFE_MODEL && result.provider === "TypeSafe" && result.costUsd === undefined;
          if (valid && Number.isSafeInteger(usage.inputTokens + tokens.input) && Number.isSafeInteger(usage.outputTokens + tokens.output)) {
            usage.completedCalls++; usage.inputTokens += tokens.input; usage.outputTokens += tokens.output; usage.knownEstimatedUsd += estimate.estimatedUsd;
          } else { usage.incomplete = true; stopped = "classifier-usage-incomplete"; }
          if (result.failure) stopped = "classifier-provider-failed";
          if (signal.aborted) { usage.incomplete = true; stopped = "classifier-request-cancelled"; throw new LLMError("infra", "Classifier request cancelled"); }
          // Return even malformed billed answers so selection telemetry records the evidence.
          return result;
        } catch (error) { usage.incomplete = true; stopped ??= "classifier-request-failed"; throw error; }
      } finally { release(); }
    } } as DecisionsClient,
  };
}
