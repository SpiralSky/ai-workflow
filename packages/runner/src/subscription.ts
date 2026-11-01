import type { LLMClient } from "@aiw/telemetry";
import { LLMError } from "@aiw/llm";

/** Explicit admission limits for shared ChatGPT plan usage, not dollar budgets. */
export interface SubscriptionLimits {
  maxCalls: number;
  /** Stop admitting requests when observed input+output tokens reach this threshold.
   * The last response can overshoot: preview Responses rejects max_output_tokens. */
  maxTokens: number;
  maxDurationMs: number;
}

/** Observed usage across every role; allowance percentage and dollar cost are unknown. */
export interface SubscriptionUsage {
  calls: number;
  completedCalls: number;
  inputTokens: number;
  outputTokens: number;
  cachedReadTokens?: number;
  cacheWriteTokens?: number;
  /** Number of completed responses reporting each cache field; sums may be partial. */
  cachedReadReportedCalls: number;
  cacheWriteReportedCalls: number;
  incomplete: boolean;
  elapsedMs: number;
}

/** Reject ambiguous/unbounded subscription campaigns before any provider traffic. */
export function validateSubscriptionLimits(limits: SubscriptionLimits): void {
  for (const name of ["maxCalls", "maxTokens", "maxDurationMs"] as const) {
    const value = limits[name];
    if (!Number.isSafeInteger(value) || value <= 0) throw new Error(`${name} must be an explicit positive safe integer`);
  }
  if (limits.maxDurationMs > 2_147_483_647) throw new Error("maxDurationMs exceeds the supported timer range");
}

/** Serializes all main/secondary calls and gates admission on shared explicit limits.
 * Calls are reserved before dispatch. Provider failures stop subsequent requests without retry.
 * Token threshold is post-response; elapsed time abort is best effort, not a refund guarantee.
 */
export function boundSubscriptionClient(client: LLMClient, limits: SubscriptionLimits): {
  client: LLMClient; snapshot: () => SubscriptionUsage; stopReason: () => string | undefined;
} {
  validateSubscriptionLimits(limits);
  const start = Date.now();
  const deadline = AbortSignal.timeout(limits.maxDurationMs);
  const usage: SubscriptionUsage = { calls: 0, completedCalls: 0, inputTokens: 0, outputTokens: 0, incomplete: false, elapsedMs: 0, cachedReadReportedCalls: 0, cacheWriteReportedCalls: 0 };
  let stopped: string | undefined;
  let queue = Promise.resolve();
  const stopReason = (): string | undefined => stopped ?? (deadline.aborted ? "subscription-time-limit" :
    usage.calls >= limits.maxCalls ? "subscription-call-limit" :
    usage.inputTokens + usage.outputTokens >= limits.maxTokens ? "subscription-token-limit" : undefined);
  return {
    snapshot: () => ({ ...usage, elapsedMs: Date.now() - start }), stopReason,
    client: {
      async complete(request) {
        let release!: () => void;
        const predecessor = queue;
        queue = new Promise<void>((resolve) => { release = resolve; });
        try {
          await predecessor;
          const reason = stopReason();
          if (reason) throw new LLMError("infra", reason);
          const caller = request.signal instanceof AbortSignal ? request.signal : undefined;
          caller?.throwIfAborted();
          const signal = caller ? AbortSignal.any([caller, deadline]) : deadline;
          signal.throwIfAborted();
          usage.calls++;
          try {
            const result = await client.complete({ ...request, signal });
            const { input, output, cachedRead, cacheWrite } = result.usage;
            for (const value of [input, output]) {
              if (!Number.isSafeInteger(value) || value < 0) throw new Error("subscription usage unavailable");
            }
            for (const value of [cachedRead, cacheWrite]) {
              if (value !== undefined && (!Number.isSafeInteger(value) || value < 0 || value > input)) throw new Error("subscription cache usage unavailable");
            }
            if (!Number.isSafeInteger(usage.inputTokens + input) || !Number.isSafeInteger(usage.outputTokens + output)) throw new Error("subscription usage overflow");
            usage.completedCalls++;
            usage.inputTokens += input;
            usage.outputTokens += output;
            if (cachedRead !== undefined) { usage.cachedReadTokens = (usage.cachedReadTokens ?? 0) + cachedRead; usage.cachedReadReportedCalls++; }
            if (cacheWrite !== undefined) { usage.cacheWriteTokens = (usage.cacheWriteTokens ?? 0) + cacheWrite; usage.cacheWriteReportedCalls++; }
            // Deliberately discard any accidental dollar field from this plan-usage backend.
            const { costUsd: _cost, ...completion } = result;
            return completion;
          } catch (error) {
            usage.incomplete = true;
            stopped = "subscription-request-failed";
            throw error;
          }
        } finally { release(); }
      },
    },
  };
}
