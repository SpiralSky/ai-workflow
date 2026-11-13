import type { LLMClient, LLMCompletion } from "@aiw/telemetry";
import { LLMError, type DecisionsClient } from "@aiw/llm";

/** Run-wide spend observed by the meter, across every role and attempt. */
export interface CostMeterSnapshot {
  budgetUsd: number;
  /** Sum of every observed request cost, including failed and retried attempts. */
  knownCostUsd: number;
  calls: number;
  costedCalls: number;
  /** A request failed or returned missing/invalid cost; the known sum is a lower bound. */
  incomplete: boolean;
}

/** One shared budget gate for the main, secondary and selection-classifier clients. */
export interface CostMeter {
  /** Why admission is closed: `budget` once the total reaches the budget, `cost-incomplete` once poisoned. */
  stopReason(): string | undefined;
  snapshot(): CostMeterSnapshot;
  /** Plan runs whose model has no price: missing cost is expected and does not poison admission. */
  readonly costOptional: boolean;
  llm(client: LLMClient): LLMClient;
  classifier(client: DecisionsClient): DecisionsClient;
}

type Costed = Pick<LLMCompletion, "costUsd" | "costSource" | "priceTable">;

/** Request size in UTF-8 bytes of the parts the provider bills as input. */
function requestBytes(parts: unknown): number {
  return Buffer.byteLength(JSON.stringify(parts) ?? "", "utf8");
}

/**
 * Creates the run's cost meter (framework-runner §6.5). Every metered request is admitted only
 * while the known cost plus the estimated cost of in-flight requests plus its own estimate stays
 * below the budget. A request that does not fit waits for in-flight requests to settle and is
 * re-checked; once nothing is in flight and it still does not fit, admission closes with `budget`.
 *
 * Requests carry no output-token limit, so there is no hard worst case. The estimate is the
 * request's input size times the highest cost per input byte observed so far for that client
 * kind; it tracks growing contexts, and a response costlier than any earlier one per byte can
 * still overshoot by the difference. Until a kind has a costed response its estimate is zero.
 *
 * A failed request, a cancelled one that still completed, or a response with missing or invalid
 * cost poisons admission, and the cost already observed is kept.
 * @param budgetUsd - positive run budget in USD
 * @param opts - `costOptional` for plan runs without a price-table entry
 * @throws Error when the budget is not a positive finite number
 */
export function createCostMeter(budgetUsd: number, opts: { costOptional?: boolean } = {}): CostMeter {
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) throw new Error("budget must be a positive finite dollar amount");
  const costOptional = opts.costOptional ?? false;
  const state: CostMeterSnapshot = { budgetUsd, knownCostUsd: 0, calls: 0, costedCalls: 0, incomplete: false };
  let reservedUsd = 0;
  let inFlight = 0;
  let budgetClosed = false;
  let waiters: (() => void)[] = [];
  // Highest observed USD per input byte, per client kind (main/secondary LLM vs classifier).
  const ratio = { llm: 0, classifier: 0 };
  const stopReason = () => state.incomplete ? "cost-incomplete" :
    budgetClosed || state.knownCostUsd >= budgetUsd ? "budget" : undefined;
  const cancelled = () => new LLMError("infra", "request cancelled");
  /** Waits until admission is possible, then reserves `estimate`; throws once admission is closed. */
  async function admit(estimate: number, signal: unknown): Promise<void> {
    for (;;) {
      const reason = stopReason();
      if (reason) throw new LLMError("infra", reason);
      if (signal instanceof AbortSignal && signal.aborted) throw cancelled();
      if (state.knownCostUsd + reservedUsd + estimate < budgetUsd) break;
      if (inFlight === 0) { budgetClosed = true; continue; }
      await new Promise<void>((resolve) => waiters.push(resolve));
    }
    reservedUsd += estimate;
    inFlight++;
    state.calls++;
  }
  const settle = (estimate: number) => {
    reservedUsd = Math.max(0, reservedUsd - estimate);
    inFlight--;
    const wake = waiters; waiters = [];
    for (const resolve of wake) resolve();
  };
  /** Records a response's cost; returns it when valid so the estimate ratio can learn from it. */
  const record = (result: Costed): number | undefined => {
    const { costUsd, costSource, priceTable } = result;
    if (costUsd === undefined && costSource === undefined && priceTable === undefined && costOptional) return undefined;
    const valid = typeof costUsd === "number" && Number.isFinite(costUsd) && costUsd >= 0 &&
      (costSource === "api" ? priceTable === undefined : (costSource === "price-table" || costSource === "api-equivalent") && typeof priceTable === "string");
    if (!valid) { state.incomplete = true; return undefined; }
    state.knownCostUsd += costUsd;
    state.costedCalls++;
    return costUsd;
  };
  /** Runs one admitted request; any failure, and a completion after cancellation, poisons admission. */
  async function metered<T extends Costed>(kind: keyof typeof ratio, bytes: number, signal: unknown, call: () => Promise<T>): Promise<T> {
    const estimate = bytes * ratio[kind];
    await admit(estimate, signal);
    let result: T;
    try { result = await call(); }
    catch (error) { state.incomplete = true; settle(estimate); throw error; }
    const cost = record(result);
    if (cost !== undefined && bytes > 0) ratio[kind] = Math.max(ratio[kind], cost / bytes);
    settle(estimate);
    if (signal instanceof AbortSignal && signal.aborted) {
      state.incomplete = true;
      throw cancelled();
    }
    return result;
  }
  return {
    stopReason, costOptional,
    snapshot: () => ({ ...state }),
    llm: (client) => ({ complete: (req) => metered("llm", requestBytes([req.system, req.tools, req.messages]), req.signal, () => client.complete(req)) }),
    classifier: (client) => ({ classify: (req) => metered("classifier", requestBytes([req.instruction, req.candidates]), req.signal, () => client.classify(req)) }),
  };
}
