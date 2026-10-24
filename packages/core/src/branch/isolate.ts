/** Host functions reachable from inside the isolate; both take and return JSON strings only. */
export interface HostFns {
  /** Async: the isolate awaits it, so concurrent calls overlap. */
  call(payload: string): Promise<string>;
  /** Sync: blocks the isolate until the host has consumed the payload. */
  flush(payload: string): void;
}

/** One sandbox. Exposed to scripts as `__host.call` / `__host.flush` (set by `bridge`). */
export interface Isolate {
  /** Compiles and runs `js` as a script named `filename` (no copy of the result is made). */
  load(js: string, filename: string): void;
  /** Installs `HostFns` as the global `__host`. */
  bridge(fns: HostFns): void;
  /** Evaluates `expr`, awaits the resulting promise and returns the string it resolves to. */
  run(expr: string): Promise<string>;
  /** Terminates any running script and frees the isolate; safe to call repeatedly. */
  dispose(): void;
  readonly disposed: boolean;
}

/** Engine abstraction (core-branch §4.1). */
export interface IsolateRuntime {
  /**
   * Creates a sandbox. `interrupt` is polled by engines that run on the host thread (QuickJS) while a
   * script executes; when it returns true the script is aborted uncatchably. Engines with their own
   * watchdog thread (isolated-vm) may ignore it.
   */
  create(opts: { memoryMb: number; interrupt?: () => boolean }): Promise<Isolate>;
}
