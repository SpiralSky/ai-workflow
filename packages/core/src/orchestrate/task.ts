import { readFile, stat } from "node:fs/promises";
import { isAbsolute, relative, resolve as resolvePath } from "node:path";
import { RefStore, stateProxy, type CodeReader } from "../refs/index.ts";
import { ChangeTracker } from "./changes.ts";

/** Lock mode of a `do` call (orchestrate-engine §3.3). */
export type LockMode = "shared" | "exclusive";

interface Waiter {
  mode: LockMode;
  grant: () => void;
}

/**
 * A FIFO read/write lock: any number of shared holders, or one exclusive holder. A new request
 * queues behind earlier waiters even when it could run now, so waiters are served in arrival order.
 */
export class RWLock {
  private readers = 0;
  private writer = false;
  private queue: Waiter[] = [];

  /**
   * @param mode - the mode to take
   * @returns a promise that resolves when the lock is held in that mode
   */
  acquire(mode: LockMode): Promise<void> {
    return new Promise((grant) => {
      this.queue.push({ mode, grant });
      this.pump();
    });
  }

  /** @param mode - the mode that was acquired */
  release(mode: LockMode): void {
    if (mode === "shared") this.readers--;
    else this.writer = false;
    this.pump();
  }

  private pump(): void {
    for (let w = this.queue[0]; w; w = this.queue[0]) {
      if (w.mode === "shared") {
        if (this.writer) return;
        this.readers++;
      } else {
        if (this.writer || this.readers > 0) return;
        this.writer = true;
      }
      this.queue.shift();
      w.grant();
    }
  }
}

/** A held lock; release it exactly once per `do` (extra releases are ignored). */
export class Lease {
  private done = false;

  constructor(private readonly lock: RWLock, private held: LockMode) {}

  /** The mode currently held. */
  get mode(): LockMode {
    return this.held;
  }

  /** Releases the lock. */
  release(): void {
    if (this.done) return;
    this.done = true;
    this.lock.release(this.held);
  }

  /** Upgrades shared to exclusive: releases the shared hold, then waits its turn for exclusive. No-op when already exclusive. */
  async upgrade(): Promise<void> {
    if (this.done || this.held === "exclusive") return;
    this.lock.release("shared");
    await this.lock.acquire("exclusive");
    this.held = "exclusive";
  }
}

/** Reads code from the workspace on disk; paths are relative to `root` and may not escape it. */
export function fsCodeReader(root: string): CodeReader {
  return {
    async readFile(path) {
      const abs = resolvePath(root, path);
      const rel = relative(root, abs);
      if (rel.startsWith("..") || isAbsolute(rel)) throw new Error(`path outside the workspace: ${path}`);
      return readFile(abs, "utf8");
    },
  };
}

/** `pathExists` over the workspace on disk (same containment rule as {@link fsCodeReader}). */
export function fsPathExists(root: string): (path: string) => Promise<boolean> {
  return async (path) => {
    const abs = resolvePath(root, path);
    const rel = relative(root, abs);
    if (rel.startsWith("..") || isAbsolute(rel)) return false;
    return stat(abs).then(() => true, () => false);
  };
}

/**
 * Per-session orchestrate state (orchestrate-engine §1): reference store, change tracker, step
 * allocation and the read/write lock of parallel `do` calls (§3.3).
 */
export class Task {
  readonly store: RefStore;
  readonly tracker: ChangeTracker;
  /** The branch `state` of the task: a proxy over the store's named values (§6.1). */
  readonly state: Record<string, unknown>;
  private readonly lock = new RWLock();

  /**
   * @param opts - `workspaceRoot` for change tracking; `maxBytes` store size cap
   */
  constructor(opts: { workspaceRoot: string; maxBytes?: number }) {
    this.store = new RefStore(opts.maxBytes);
    this.tracker = new ChangeTracker(opts.workspaceRoot);
    this.state = stateProxy(this.store, () => this.store.stepCount);
  }

  /**
   * Allocates the next step `sN` (monotonic; never reused).
   * @param init - instruction and executor model
   * @returns N
   */
  startStep(init: { instruction: string; executor?: string }): number {
    return this.store.startStep(init);
  }

  /**
   * Takes the task lock: shared for a shortlist of only `read` tools, exclusive otherwise.
   * @param mode - the mode to take
   * @returns the lease to upgrade and release
   */
  async acquire(mode: LockMode): Promise<Lease> {
    await this.lock.acquire(mode);
    return new Lease(this.lock, mode);
  }
}
