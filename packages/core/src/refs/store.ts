import { isValidName } from "./parse.ts";

/** Error thrown by the reference store and resolver. `code` is `expired`, `RefNotFound` or `invalid`. */
export class RefError extends Error {
  constructor(
    readonly code: "expired" | "RefNotFound" | "invalid",
    message: string,
  ) {
    super(message);
    this.name = code === "RefNotFound" ? "RefNotFound" : "RefError";
  }
}

/** A stored live code reference (branching-framework §4.4): where something lives plus a content hash. */
export interface LiveRef {
  ref: string;
  version: string;
}

/** True for a value shaped like a {@link LiveRef}. */
export function isLiveRef(v: unknown): v is LiveRef {
  return !!v && typeof v === "object" && typeof (v as LiveRef).ref === "string" && typeof (v as LiveRef).version === "string" && Object.keys(v).length === 2;
}

/** Paths changed during a step. */
export interface StepChanges {
  added: string[];
  modified: string[];
  deleted: string[];
}

/** One step `sN`. */
export interface StepRecord {
  n: number;
  instruction: string;
  report?: string;
  executor?: string;
  startedAt: number;
  endedAt?: number;
  changed: StepChanges;
}

/** Outcome of a tool call, used for generated summaries. */
export interface CallOutcome {
  ok: boolean;
  exitCode?: number;
  error?: string;
}

/** One call `sN.cK`. `result` is `undefined` once `evicted`. */
export interface CallRecord {
  step: number;
  k: number;
  tool: string;
  args: unknown;
  result?: unknown;
  outcome: CallOutcome;
  evicted: boolean;
  size: number;
}

/** One version of a named value. */
export interface NamedEntry {
  step: number;
  value: unknown;
  summary?: string;
  kind: "snapshot" | "live";
  deleted?: boolean;
}

/** Approximate stored size: JSON length (0 for undefined or unserialisable values). */
export function sizeOf(v: unknown): number {
  try {
    return JSON.stringify(v)?.length ?? 0;
  } catch {
    return 0;
  }
}

/** Deep-copies JSON data so stored snapshots are immutable; throws `RefError` `invalid` otherwise. */
function cloneJSON<T>(v: T, what: string): T {
  try {
    return JSON.parse(JSON.stringify(v)) as T;
  } catch {
    throw new RefError("invalid", `${what} is not JSON-serialisable`);
  }
}

/**
 * The task's reference store (orchestrate-engine §6): steps, calls and versioned named values,
 * with a size cap that evicts the oldest unnamed call results first.
 */
export class RefStore {
  private steps: StepRecord[] = [];
  private calls = new Map<number, CallRecord[]>();
  private named = new Map<string, NamedEntry[]>();
  private bytes = 0;

  /** @param maxBytes - size cap (JSON length) for stored values; default 20 MB */
  constructor(readonly maxBytes = 20 * 1024 * 1024) {}

  /** Number of steps started so far. */
  get stepCount(): number {
    return this.steps.length;
  }

  /** Estimated bytes currently stored. */
  get size(): number {
    return this.bytes;
  }

  /**
   * Starts the next step.
   * @param init - instruction and optional executor model / start time
   * @returns the step number N (1-based)
   */
  startStep(init: { instruction: string; executor?: string; startedAt?: number }): number {
    const n = this.steps.length + 1;
    this.steps.push({ n, instruction: init.instruction, executor: init.executor, startedAt: init.startedAt ?? Date.now(), changed: { added: [], modified: [], deleted: [] } });
    this.bytes += init.instruction.length;
    this.enforceCap();
    return n;
  }

  /** Records a step's report, end time and changed paths. */
  finishStep(n: number, done: { report: string; changed?: StepChanges; endedAt?: number }): void {
    const s = this.step(n);
    this.bytes += done.report.length - (s.report?.length ?? 0);
    s.report = done.report;
    s.endedAt = done.endedAt ?? Date.now();
    if (done.changed) s.changed = done.changed;
    this.enforceCap();
  }

  /** @throws RefError `RefNotFound` for an unknown step */
  step(n: number): StepRecord {
    const s = this.steps[n - 1];
    if (!s) throw new RefError("RefNotFound", `no step ${n}`);
    return s;
  }

  /** Number of calls recorded in step `n` (0 for an unknown step). */
  callCount(n: number): number {
    return this.calls.get(n)?.length ?? 0;
  }

  /**
   * Adds the next call of step `n`; the full result is stored.
   * @returns the call number K (1-based, in call order across the step)
   */
  addCall(n: number, call: { tool: string; args: unknown; result: unknown; outcome: CallOutcome }): number {
    this.step(n);
    const list = this.calls.get(n) ?? [];
    this.calls.set(n, list);
    const size = sizeOf(call.args) + sizeOf(call.result);
    list.push({ step: n, k: list.length + 1, tool: call.tool, args: call.args, result: call.result, outcome: call.outcome, evicted: false, size });
    this.bytes += size;
    this.enforceCap();
    return list.length;
  }

  /**
   * @throws RefError `RefNotFound` for an unknown call, `expired` when the result was evicted
   */
  call(n: number, k: number): CallRecord {
    const c = this.calls.get(n)?.[k - 1];
    if (!c) throw new RefError("RefNotFound", `no call ${k} in step ${n}`);
    if (c.evicted) throw new RefError("expired", `@s${n}.c${k} expired: its result was dropped to stay under the ${this.maxBytes}-byte task cap`);
    return c;
  }

  /** True when call `k` of step `n` exists but its result was evicted. */
  isEvicted(n: number, k: number): boolean {
    return this.calls.get(n)?.[k - 1]?.evicted ?? false;
  }

  /**
   * Writes a named value at `step` (replacing an earlier write by the same step). The value is
   * deep-copied. Kind is `live` for a {@link LiveRef}, else `snapshot`. `undefined` deletes the name.
   * @throws RefError `invalid` for a bad name or non-JSON value, `RefNotFound` for an unknown step
   */
  setNamed(name: string, value: unknown, step: number, summary?: string): void {
    if (!isValidName(name)) throw new RefError("invalid", `"${name}" is not a valid reference name`);
    this.step(step);
    const entry: NamedEntry =
      value === undefined
        ? { step, value: undefined, kind: "snapshot", deleted: true }
        : { step, value: cloneJSON(value, `value for "${name}"`), summary, kind: isLiveRef(value) ? "live" : "snapshot" };
    const hist = this.named.get(name) ?? [];
    this.named.set(name, hist);
    const last = hist[hist.length - 1];
    if (last && last.step === step) {
      this.bytes -= sizeOf(last.value);
      hist[hist.length - 1] = entry;
    } else hist.push(entry);
    this.bytes += sizeOf(entry.value);
    this.enforceCap();
  }

  /** `tools.save`: same entry as `state[name] = value`, with a summary. */
  save(args: { name: string; value: unknown; summary?: string }, step: number): void {
    this.setNamed(args.name, args.value, step, args.summary);
  }

  /** Names whose latest version is not deleted, in first-write order. */
  names(): string[] {
    return [...this.named].filter(([, h]) => !h[h.length - 1]!.deleted).map(([k]) => k);
  }

  /** Full version history of a name (oldest first), including deletions. */
  history(name: string): NamedEntry[] {
    return this.named.get(name) ?? [];
  }

  /**
   * The value of `name`, latest or as of step `asOf`.
   * @throws RefError `RefNotFound` when absent or deleted
   */
  getNamed(name: string, asOf?: number): NamedEntry {
    const hist = this.named.get(name) ?? [];
    const e = asOf === undefined ? hist[hist.length - 1] : [...hist].reverse().find((h) => h.step <= asOf);
    if (!e || e.deleted) throw new RefError("RefNotFound", asOf === undefined ? `no value named "${name}"` : `"${name}" had no value as of step ${asOf}`);
    return e;
  }

  /** The latest step that added, modified or deleted `path`, if any. */
  lastChangedBy(path: string): number | undefined {
    for (let i = this.steps.length - 1; i >= 0; i--) {
      const c = this.steps[i]!.changed;
      if (c.added.includes(path) || c.modified.includes(path) || c.deleted.includes(path)) return this.steps[i]!.n;
    }
    return undefined;
  }

  /** Drops the oldest unnamed call results until under the cap (named values and steps are never dropped). */
  private enforceCap(): void {
    if (this.bytes <= this.maxBytes) return;
    for (const list of [...this.calls].sort((a, b) => a[0] - b[0]).map(([, l]) => l)) {
      for (const c of list) {
        if (this.bytes <= this.maxBytes) return;
        if (c.evicted) continue;
        this.bytes -= c.size;
        c.evicted = true;
        c.result = undefined;
        c.args = undefined;
        c.size = 0;
      }
    }
  }
}

/**
 * A `Proxy` acting as the branch `State`: `state.x = v` writes a named value recorded at the
 * current step, reads return the latest value, `delete` removes the name (history stays).
 * Assigning `undefined` is a delete. Symbol keys are ignored.
 * @param store - the task's store
 * @param currentStep - the running step number, or a function returning it
 */
export function stateProxy(store: RefStore, currentStep: number | (() => number)): Record<string, unknown> {
  const step = () => (typeof currentStep === "function" ? currentStep() : currentStep);
  return new Proxy({} as Record<string, unknown>, {
    get: (_t, key) => (typeof key === "string" && store.names().includes(key) ? store.getNamed(key).value : undefined),
    set: (_t, key, value) => {
      if (typeof key !== "string") return false;
      store.setNamed(key, value, step());
      return true;
    },
    deleteProperty: (_t, key) => {
      if (typeof key === "string" && store.names().includes(key)) store.setNamed(key, undefined, step());
      return true;
    },
    has: (_t, key) => typeof key === "string" && store.names().includes(key),
    ownKeys: () => store.names(),
    getOwnPropertyDescriptor: (_t, key) =>
      typeof key === "string" && store.names().includes(key) ? { value: store.getNamed(key).value, writable: true, enumerable: true, configurable: true } : undefined,
  });
}
