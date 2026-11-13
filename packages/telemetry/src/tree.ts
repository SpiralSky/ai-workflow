import type { EventOf, EventRecord, Role, Usage } from "./schema.ts";
import { LLM_COST_INCOMPLETE_KEY } from "./wrap.ts";

export interface TreeNode {
  /** null for the synthetic root. */
  event: EventRecord | null;
  children: TreeNode[];
  /** Set when the declared parent never appeared (e.g. crash). */
  orphan?: true;
}

/**
 * Links events by `parent`. Order-independent: a child may precede its parent's line. When a
 * `toolStart` and `tool` share an id, the `tool` wins (a lone `toolStart` is an in-flight call).
 * Parent null links to the root; unknown parents attach to the root flagged `orphan`.
 * @param events - parsed events in file order
 */
export function buildTree(events: EventRecord[]): TreeNode {
  const nodes = new Map<string, TreeNode>();
  const list: TreeNode[] = [];
  for (const event of events) {
    const existing = nodes.get(event.id);
    if (existing) {
      if (existing.event?.kind === "toolStart" && event.kind === "tool") existing.event = event;
      continue;
    }
    const n: TreeNode = { event, children: [] };
    nodes.set(event.id, n);
    list.push(n);
  }
  const root: TreeNode = { event: null, children: [] };
  for (const n of list) {
    const p = n.event!.parent;
    if (p === null) root.children.push(n);
    else {
      const parent = nodes.get(p);
      if (parent && parent !== n) parent.children.push(n);
      else {
        n.orphan = true;
        root.children.push(n);
      }
    }
  }
  return root;
}

export interface TokenSums {
  /** Sums are known lower bounds when a turn omitted usage. */
  incomplete?: true;
  input: number;
  output: number;
  cachedRead?: number;
  cacheWrite?: number;
}

export interface Rollups {
  costUsd: number | null;
  mainTurns: number;
  secondaryTurns: number;
  topLevelToolCalls: number;
  leafToolCalls: number;
  tokens: Record<Role, TokenSums>;
  toolTimeMs: number;
  modelTimeMs: number;
  callsPerTool: Record<string, number>;
  externalCalls: number;
  editCalls: { refactor: number; manual: number };
}

/**
 * Computes the telemetry §7 rollups from `turn` and `tool` events. An uncertainty marker
 * can invalidate cost completeness, but never contributes a charge or token count.
 * `tokens` always has all three roles (zero input/output when a role had no turns); `cachedRead`
 * and `cacheWrite` appear only if some turn of that role reported them.
 * @param events - parsed events
 * @param groups - tool names in the `external` and `refactor` groups
 */
export function rollups(
  events: EventRecord[],
  groups: { externalTools: string[]; refactorTools: string[] },
): Rollups {
  const turns = events.filter((e): e is EventOf<"turn"> => e.kind === "turn");
  const tools = events.filter((e): e is EventOf<"tool"> => e.kind === "tool");
  const toolIds = new Set(tools.map((t) => t.id));
  const parentOf = new Map<string, string | null>();
  for (const e of events) if (e.kind === "tool" || !parentOf.has(e.id)) parentOf.set(e.id, e.parent);

  // Mark every tool that has a tool somewhere below it.
  const hasToolBelow = new Set<string>();
  for (const t of tools) {
    const seen = new Set<string>([t.id]);
    let p = t.parent;
    while (p !== null && !seen.has(p)) {
      seen.add(p);
      if (toolIds.has(p)) hasToolBelow.add(p);
      p = parentOf.get(p) ?? null;
    }
  }

  const tokens: Record<Role, TokenSums> = {
    main: { input: 0, output: 0 },
    secondary: { input: 0, output: 0 },
    selection: { input: 0, output: 0 },
  };
  let cost: number | null = events.some(e => e.kind === "attach" && e.key === LLM_COST_INCOMPLETE_KEY) ? null : 0;
  for (const t of turns) {
    const s = tokens[t.role];
    const u = t.usage;
    if (!u) { s.incomplete = true; cost = null; continue; }
    s.input += u.input;
    s.output += u.output;
    if (u.cachedRead !== undefined) s.cachedRead = (s.cachedRead ?? 0) + u.cachedRead;
    if (u.cacheWrite !== undefined) s.cacheWrite = (s.cacheWrite ?? 0) + u.cacheWrite;
    cost = t.costUsd === undefined || cost === null ? null : cost + t.costUsd;
  }

  const callsPerTool: Record<string, number> = {};
  for (const t of tools) callsPerTool[t.name] = (callsPerTool[t.name] ?? 0) + 1;
  const ext = new Set(groups.externalTools);
  const ref = new Set(groups.refactorTools);
  const top = tools.filter((t) => t.parent === null);

  return {
    costUsd: cost,
    mainTurns: turns.filter((t) => t.role === "main").length,
    secondaryTurns: turns.filter((t) => t.role !== "main").length,
    topLevelToolCalls: top.length,
    leafToolCalls: tools.filter((t) => !hasToolBelow.has(t.id)).length,
    tokens,
    toolTimeMs: top.reduce((a, t) => a + t.durationMs, 0),
    modelTimeMs: turns.reduce((a, t) => a + t.latencyMs, 0),
    callsPerTool,
    externalCalls: tools.filter((t) => ext.has(t.name)).length,
    editCalls: {
      refactor: tools.filter((t) => ref.has(t.name)).length,
      manual: tools.filter((t) => t.name === "edit" || t.name === "multiEdit").length,
    },
  };
}
