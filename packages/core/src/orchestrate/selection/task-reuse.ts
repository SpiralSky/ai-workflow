import { serialize } from "node:v8";
import type { Selector, Selection } from "./index.ts";
import { accountedSelections, selectorIdentities } from "./reuse-proof.ts";

/** A single task owner. Advance revisions for every workspace/reference-state change.
 * Treatment identifies provider routing/model/policy configuration; never recycle revisions.
 * No engine/runner integration currently supplies this object automatically.
 */
export interface SelectionReuseScope {
  taskId: string;
  stateRevision: string;
  referenceRevision: string;
  treatment: string;
}

/**
 * Experimental, opt-in, single-task selector memo. Inject via orchestrate.selector only in a
 * task-bound integration that also supplies the identical reuseScope on every query.
 * Unsupported selectors/rerankers fail closed (run normally, never cache).
 * Concurrent requests are rejected, not shared. Dispose at task end.
 */
export function createTaskScopedSelector(opts: {
  selector: Selector; scope: SelectionReuseScope; maxEntries?: number; maxBytes?: number;
}): Selector & { dispose(): void } {
  const { selector, scope } = opts;
  const maxEntries = opts.maxEntries ?? 32;
  const maxBytes = opts.maxBytes ?? 1024 * 1024;
  if (!Number.isSafeInteger(maxEntries) || maxEntries < 1 || !Number.isSafeInteger(maxBytes) || maxBytes < 1) {
    throw new Error("Selection reuse limits must be positive safe integers");
  }
  const taskId = scope.taskId;
  const identity = selectorIdentities.get(selector);
  const entries = new Map<string, { value: Selection; bytes: number; proof: string }>();
  let bytes = 0;
  let active = false;
  let disposed = false;
  let observedRevision: string | undefined;
  /** Snapshot explicit ownership and invalidation identity. */
  const revision = () => {
    if (scope.taskId !== taskId || ![taskId, scope.stateRevision, scope.referenceRevision, scope.treatment]
        .every(value => typeof value === "string" && value.length > 0)) {
      throw new Error("Selection reuse requires one task and explicit nonempty revisions/treatment");
    }
    return serialize([taskId, scope.stateRevision, scope.referenceRevision, scope.treatment]).toString("base64");
  };
  /** Clear the old partition whenever a transition is observed, including after await. */
  const observeRevision = () => {
    const current = revision();
    if (current !== observedRevision) {
      entries.clear(); bytes = 0; observedRevision = current;
    }
    return current;
  };
  return {
    dispose() { disposed = true; entries.clear(); bytes = 0; },
    async select(q, catalog) {
      q.signal?.throwIfAborted();
      if (disposed) throw new Error("Selection reuse scope disposed");
      if (active) throw new Error("Concurrent selection reuse is unsupported");
      active = true;
      try {
        // Materialize a single-use iterable exactly once; snapshot mutable caller data.
        const exclude = q.exclude === undefined ? undefined : [...q.exclude];
        const input = structuredClone({ instruction: q.instruction, override: q.override, exclude, catalog });
        const scoped = q.reuseScope === scope && identity !== undefined && q.reporter !== undefined;
        const before = observeRevision();
        const key = serialize([identity, before, input]).toString("base64");
        q.signal?.throwIfAborted();
        const hit = scoped ? entries.get(key) : undefined;
        if (hit) {
          entries.delete(key); entries.set(key, hit);
          q.reporter?.attach("selectionReuse", { kind: "task-local-hit", billing: "none", taskId,
            stateRevision: scope.stateRevision, referenceRevision: scope.referenceRevision,
            treatment: scope.treatment, sourceTreatment: hit.proof });
          q.signal?.throwIfAborted();
          return structuredClone(hit.value);
        }
        const value = await selector.select({ ...q, instruction: input.instruction,
          override: input.override, exclude: input.exclude }, input.catalog);
        q.signal?.throwIfAborted();
        if (disposed) throw new Error("Selection reuse scope disposed during request");
        if (observeRevision() !== before) throw new Error("Selection reuse revision changed during request");
        const proof = accountedSelections.get(value);
        const copy = structuredClone(value);
        if (scoped && proof && !value.stages.rerankFallback && !value.stages.override) {
          const size = Buffer.byteLength(key) + serialize(copy).byteLength + Buffer.byteLength(proof);
          if (size <= maxBytes) {
            while (entries.size >= maxEntries || bytes + size > maxBytes) {
              const oldest = entries.keys().next().value!;
              bytes -= entries.get(oldest)!.bytes; entries.delete(oldest);
            }
            entries.set(key, { value: copy, bytes: size, proof }); bytes += size;
          }
        }
        return structuredClone(copy);
      } catch (error) {
        // A rejected transport may still have incurred an unobserved charge. Preserve the
        // failure without inventing a zero-cost turn or duplicating any observed turn.
        q.reporter?.attach("selectionReuse", { kind: "request-failed", reusable: false,
          accounting: "see-original-turns-or-unknown", status: "failed" });
        throw error;
      } finally { active = false; }
    },
  };
}
