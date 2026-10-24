import { extractRefs, type Rendered, type RefStore } from "../refs/index.ts";
import type { SelectionStages } from "./selection/index.ts";

/** A `findTools` call, logged as a selection miss of kind `escalation` (orchestrate §10.1). */
export interface Escalation {
  kind: "escalation";
  need: string;
  /** Names of the tools it added (empty when nothing was found). */
  tools: string[];
}

/** One reference of the instruction as the executor received it. */
export interface HandoffRef {
  ref: string;
  mode: "inline" | "handle";
  /** Content length in characters before rendering. */
  chars: number;
  stale: boolean;
  nested?: boolean;
  /** The text the executor received for this reference. */
  received: string;
  /** The step a snapshot came from, when the reference has one. */
  step?: number;
}

/** The handoff record (orchestrate §8.4): exactly these fields. */
export interface HandoffRecord {
  /** As the planner wrote it, references unresolved. */
  instruction: string;
  references: HandoffRef[];
  selection: {
    /** Final shortlist names in order, as first given to the executor. */
    shortlist: string[];
    /** Per-stage scores and order. */
    stages: SelectionStages;
    /** The planner's `tools` override, if any. */
    override?: string[];
    escalations: Escalation[];
    /** Selection misses known when the record is written (escalations; fallbacks are added by the report). */
    misses: Escalation[];
  };
  /** Ids of hot-path snippets included. */
  hotPaths: string[];
  budget: { turns: number; used: number; exhausted: boolean };
  model: string;
}

/** The step a reference's content came from, if it has one. */
function sourceStep(store: RefStore, raw: string): number | undefined {
  const t = extractRefs(raw)[0];
  if (!t) return undefined;
  try {
    switch (t.kind) {
      case "step": return t.n;
      case "range": return t.to;
      case "call": return t.n;
      case "namedAt": return t.n;
      case "named": return store.getNamed(t.name).step;
      default: return undefined;
    }
  } catch {
    return undefined;
  }
}

/** Inputs of {@link buildHandoff}. */
export interface HandoffInput {
  instruction: string;
  rendered: Rendered;
  store: RefStore;
  shortlist: string[];
  stages: SelectionStages;
  override?: string[];
  escalations: Escalation[];
  hotPaths: string[];
  budget: { turns: number; used: number; exhausted: boolean };
  model: string;
}

/**
 * Assembles the handoff record; the caller attaches it with `reporter.attach("orchestrate.handoff", record)`.
 * @param input - the pieces collected while the executor ran
 * @returns the record with exactly the orchestrate §8.4 fields
 */
export function buildHandoff(input: HandoffInput): HandoffRecord {
  const references = input.rendered.records.map((r): HandoffRef => {
    const block = input.rendered.inline.find((i) => i.ref === r.ref)?.text;
    const handle = input.rendered.handles.find((h) => h.startsWith(`${r.ref} —`));
    return { ...r, received: (r.mode === "inline" ? block : handle) ?? "", step: sourceStep(input.store, r.ref) };
  });
  return {
    instruction: input.instruction,
    references,
    selection: {
      shortlist: input.shortlist,
      stages: input.stages,
      ...(input.override ? { override: input.override } : {}),
      escalations: input.escalations,
      misses: input.escalations,
    },
    hotPaths: input.hotPaths,
    budget: input.budget,
    model: input.model,
  };
}
