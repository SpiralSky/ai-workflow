import type { CostSource, Usage } from "@aiw/telemetry";

/** Version of `PRICE_TABLE`; recorded on every price-table cost so it can be recomputed later. */
export const PRICE_TABLE_VERSION = "2026-11-13";

/** USD per million tokens, per usage category (framework-runner §4.1). */
export interface ModelPrice {
  uncachedInput: number;
  cachedRead: number;
  /** Omitted when the provider has no separate cache-write rate. */
  cacheWrite?: number;
  output: number;
}

/**
 * Price table keyed by the model id the provider client sends. Time-of-day rates are separate
 * entries; a model without an entry has no price, and nothing invents one.
 */
export const PRICE_TABLE: Readonly<Record<string, ModelPrice>> = {
  // DeepSeek v4 Flash, off-peak rates. The direct client only dispatches off-peak.
  "deepseek-flash": { uncachedInput: 0.15, cachedRead: 0.003, output: 0.6 },
  // TypeSafe Decisions jev-1.14.0: input billed at one rate, output free.
  "jev-1.14.0": { uncachedInput: 0.042, cachedRead: 0.042, output: 0 },
};

/** A priced turn: dollar cost with its source, and the table version for table prices. */
export interface TurnCost {
  costUsd: number;
  costSource: CostSource;
  priceTable?: string;
}

/**
 * Prices token usage from the price table. Uncached input is the input not reported as
 * cached-read or cache-write. Cache-write tokens on a model without a cache-write rate are unpriced.
 * @param model - provider model id (the table key)
 * @param usage - token counts of one turn
 * @returns the USD cost, or `undefined` when the model has no entry or the counts cannot be priced
 */
export function priceUsage(model: string, usage: Usage): number | undefined {
  const price = Object.hasOwn(PRICE_TABLE, model) ? PRICE_TABLE[model] : undefined;
  if (!price) return undefined;
  const cachedRead = usage.cachedRead ?? 0;
  const cacheWrite = usage.cacheWrite ?? 0;
  const uncached = usage.input - cachedRead - cacheWrite;
  if (![usage.input, usage.output, cachedRead, cacheWrite].every((n) => Number.isFinite(n) && n >= 0) || uncached < 0) return undefined;
  if (cacheWrite > 0 && price.cacheWrite === undefined) return undefined;
  return (uncached * price.uncachedInput + cachedRead * price.cachedRead +
    cacheWrite * (price.cacheWrite ?? 0) + usage.output * price.output) / 1e6;
}

/**
 * Builds the cost fields of a turn priced from the table.
 * @param model - provider model id
 * @param usage - token counts of the turn
 * @param source - `price-table` for billed direct providers, `api-equivalent` for plan usage
 * @returns cost fields, or an empty object when the model has no price
 */
export function tableCost(model: string, usage: Usage, source: "price-table" | "api-equivalent" = "price-table"): Partial<TurnCost> {
  const costUsd = priceUsage(model, usage);
  return costUsd === undefined ? {} : { costUsd, costSource: source, priceTable: PRICE_TABLE_VERSION };
}
