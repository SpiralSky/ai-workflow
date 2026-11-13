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

/**
 * Creates the run's cost meter (framework-runner §6.5). Every metered request is admitted only
 * while the total is below the budget; the threshold is checked before each request, so the last
 * response can overshoot. A failed request, a cancelled one that still completed, or a response
 * with missing or invalid cost poisons admission, and the cost already observed is kept.
 * @param budgetUsd - positive run budget in USD
 * @param opts - `costOptional` for plan runs without a price-table entry
 * @throws Error when the budget is not a positive finite number
 */
export function createCostMeter(budgetUsd: number, opts: { costOptional?: boolean } = {}): CostMeter {
  if (!Number.isFinite(budgetUsd) || budgetUsd <= 0) throw new Error("budget must be a positive finite dollar amount");
  const costOptional = opts.costOptional ?? false;
  const state: CostMeterSnapshot = { budgetUsd, knownCostUsd: 0, calls: 0, costedCalls: 0, incomplete: false };
  const stopReason = () => state.incomplete ? "cost-incomplete" : state.knownCostUsd >= budgetUsd ? "budget" : undefined;
  const admit = () => {
    const reason = stopReason();
    if (reason) throw new LLMError("infra", reason);
    state.calls++;
  };
  const record = (result: Costed) => {
    const { costUsd, costSource, priceTable } = result;
    if (costUsd === undefined && costSource === undefined && priceTable === undefined && costOptional) return;
    const valid = typeof costUsd === "number" && Number.isFinite(costUsd) && costUsd >= 0 &&
      (costSource === "api" ? priceTable === undefined : (costSource === "price-table" || costSource === "api-equivalent") && typeof priceTable === "string");
    if (!valid) { state.incomplete = true; return; }
    state.knownCostUsd += costUsd;
    state.costedCalls++;
  };
  /** Runs one admitted request; any failure, and a completion after cancellation, poisons admission. */
  async function metered<T extends Costed>(signal: unknown, call: () => Promise<T>): Promise<T> {
    admit();
    let result: T;
    try { result = await call(); }
    catch (error) { state.incomplete = true; throw error; }
    record(result);
    if (signal instanceof AbortSignal && signal.aborted) {
      state.incomplete = true;
      throw new LLMError("infra", "request cancelled");
    }
    return result;
  }
  return {
    stopReason, costOptional,
    snapshot: () => ({ ...state }),
    llm: (client) => ({ complete: (req) => metered(req.signal, () => client.complete(req)) }),
    classifier: (client) => ({ classify: (req) => metered(req.signal, () => client.classify(req)) }),
  };
}
