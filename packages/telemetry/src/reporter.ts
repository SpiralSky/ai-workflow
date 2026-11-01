import type { Blobs } from "./blobs.ts";
import type { EventRecord, Role, Usage } from "./schema.ts";
import type { Sink } from "./sink.ts";

export interface Reporter {
  readonly scope: string | null;
  turn(e: {
    model: string;
    providerModel?: string;
    providerSystemFingerprint?: string;
    role: Role;
    usage: Usage;
    costUsd?: number;
    cacheHit?: boolean;
    latencyMs: number;
  }): string;
  tool(e: {
    id?: string;
    name: string;
    args: unknown;
    ok: boolean;
    durationMs: number;
    error?: string;
    harnessId?: string;
    startTs: number;
    resultBytes: number;
  }): string;
  toolStart(e: { id: string; name: string; args: unknown; harnessId?: string }): void;
  child(label: string, id?: string): Reporter;
  attach(key: string, data: unknown): void;
  newId(): string;
}

/** Attachments at or above this many bytes of JSON go to the blob store. */
export const ATTACH_INLINE_LIMIT = 64 * 1024;

interface Shared {
  sink: Sink;
  writer: "r" | "s";
  blobs?: Blobs;
  clock: () => number;
  counter: number;
}

/** Reporter implementation; adds the internal `scopedTo` and `emit` used by helpers. */
export class ReporterImpl implements Reporter {
  constructor(
    private readonly shared: Shared,
    readonly scope: string | null,
    private readonly harnessId?: string,
  ) {}

  newId(): string {
    return `${this.shared.writer}:${++this.shared.counter}`;
  }

  /**
   * Writes a record with the common fields filled in.
   * @param kind - event kind
   * @param id - event id
   * @param parent - parent id
   * @param fields - kind-specific fields; `undefined` values are dropped
   */
  emit(kind: EventRecord["kind"], id: string, parent: string | null, fields: object): void {
    const rec: Record<string, unknown> = { v: 1, id, parent, ts: this.shared.clock(), kind };
    for (const [k, val] of Object.entries(fields)) if (val !== undefined) rec[k] = val;
    this.shared.sink.write(rec);
  }

  turn(e: Parameters<Reporter["turn"]>[0]): string {
    const id = this.newId();
    this.emit("turn", id, this.scope, e);
    return id;
  }

  tool(e: Parameters<Reporter["tool"]>[0]): string {
    const id = e.id ?? this.newId();
    this.emit("tool", id, this.scope, { ...e, id: undefined, harnessId: this.harnessFor(e.harnessId) });
    return id;
  }

  toolStart(e: Parameters<Reporter["toolStart"]>[0]): void {
    this.emit("toolStart", e.id, this.scope, { ...e, id: undefined, harnessId: this.harnessFor(e.harnessId) });
  }

  child(label: string, id?: string): Reporter {
    const cid = id ?? this.newId();
    this.emit("scope", cid, this.scope, { label });
    return this.scopedTo(cid);
  }

  /**
   * Returns a reporter nested under `id` WITHOUT writing a `scope` event. Used by `wrapTools`,
   * where the tool event itself is the parent, so a separate scope line would be redundant.
   * @param id - event id to nest under (null = root)
   * @param harnessId - harness id for root-level calls; defaults to this reporter's
   */
  scopedTo(id: string | null, harnessId = this.harnessId): ReporterImpl {
    return new ReporterImpl(this.shared, id, harnessId);
  }

  attach(key: string, data: unknown): void {
    const id = this.newId();
    const json = JSON.stringify(data) ?? "null";
    if (this.shared.blobs && Buffer.byteLength(json) >= ATTACH_INLINE_LIMIT) {
      this.emit("attach", id, this.scope, { key, blob: this.shared.blobs.put(json) });
    } else {
      this.emit("attach", id, this.scope, { key, data });
    }
  }

  // Harness case: root-level calls with no explicit harnessId inherit the reporter's.
  private harnessFor(given?: string): string | undefined {
    return given ?? (this.scope === null ? this.harnessId : undefined);
  }
}

export interface ReporterOptions {
  sink: Sink;
  writer: "r" | "s";
  blobs?: Blobs;
  parent?: string | null;
  harnessId?: string;
  clock?: () => number;
}

/**
 * Creates a root reporter. All children share one id counter.
 * @param opts - sink, writer prefix, optional blob store, initial parent scope, harness id, clock
 */
export function createReporter(opts: ReporterOptions): ReporterImpl {
  return new ReporterImpl(
    { sink: opts.sink, writer: opts.writer, blobs: opts.blobs, clock: opts.clock ?? Date.now, counter: 0 },
    opts.parent ?? null,
    opts.harnessId,
  );
}

type Target = Reporter | Sink;

function write(target: Target, kind: "job" | "end", fallbackId: string, fields: object): void {
  if (target instanceof ReporterImpl) target.emit(kind, target.newId(), null, fields);
  else (target as Sink).write({ v: 1, id: fallbackId, parent: null, ts: Date.now(), kind, ...fields });
}

/**
 * Writes the runner's first line (`job`, parent null). With a bare Sink the id is `r:job`.
 * @param target - reporter (id from its counter) or sink
 * @param f - job, attempt, framework, problem, rep
 */
export function writeJobStart(
  target: Target,
  f: { job: string; attempt: number; framework: string; problem: string; rep: number },
): void {
  write(target, "job", "r:job", f);
}

/**
 * Writes the runner's last line (`end`, parent null). With a bare Sink the id is `r:end`.
 * @param target - reporter or sink
 * @param f - outcome and optional reason
 */
export function writeJobEnd(target: Target, f: { outcome: string; reason?: string }): void {
  write(target, "end", "r:end", f);
}
