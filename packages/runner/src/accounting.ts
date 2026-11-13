import { readFileSync } from "node:fs";
import { EventSchema, LLM_COST_INCOMPLETE_KEY } from "@aiw/telemetry";

/** Complete billed cost or a known lower bound when telemetry is incomplete. */
export interface CostSummary {
  costUsd: number | null;
  knownCostUsd: number;
  costIncompleteReasons: string[];
}

/** Reads a quiescent, single-attempt event log. Never adds harness totals to event charges.
 * @param eventsPath - event log after all writers have stopped
 * @param extraReasons - uncertainty not representable by completed turn events
 */
export function readAttemptCost(eventsPath: string, extraReasons: string[] = []): CostSummary {
  const reasons = new Set(extraReasons);
  let knownCostUsd = 0;
  const ids = new Set<string>();
  const sources = new Set<string>();
  let text: string;
  try { text = readFileSync(eventsPath, "utf8"); }
  catch { return { costUsd: null, knownCostUsd: 0, costIncompleteReasons: [...reasons, "events-unreadable"] }; }
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let event;
    try { event = EventSchema.parse(JSON.parse(line)); }
    catch { reasons.add("malformed-event"); continue; }
    if (event.kind === "attach" && event.key === LLM_COST_INCOMPLETE_KEY) {
      reasons.add("unobserved-failed-model-request");
    }
    if (event.kind !== "turn") continue;
    if (ids.has(event.id)) { reasons.add("duplicate-turn-id"); continue; }
    ids.add(event.id);
    if (!event.usage) reasons.add("missing-turn-usage");
    if (event.costUsd === undefined || !Number.isFinite(event.costUsd) || event.costUsd < 0) {
      reasons.add("missing-or-invalid-turn-cost");
    } else knownCostUsd += event.costUsd;
    if (event.costSource) sources.add(event.costSource);
  }
  // API-equivalent plan cost is never added to billed cost (framework-runner §4.1).
  if (sources.has("api-equivalent") && sources.size > 1) reasons.add("mixed-cost-sources");
  return { costUsd: reasons.size ? null : knownCostUsd, knownCostUsd, costIncompleteReasons: [...reasons] };
}

/** Carries incurred charges through failure; never converts failed work to zero spend. */
export class AttemptFailure extends Error {
  constructor(cause: unknown, readonly cost: CostSummary, readonly eventsPath: string, readonly durationMs: number) {
    super(cause instanceof Error ? cause.message : String(cause), { cause });
    this.name = "AttemptFailure";
  }
}
