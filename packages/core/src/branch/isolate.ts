import ivm from "isolated-vm";

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
  create(opts: { memoryMb: number }): Isolate;
}

/** Default engine: `isolated-vm` (V8 isolate with a heap limit; no require/process in the context). */
export const isolatedVMRuntime: IsolateRuntime = {
  create({ memoryMb }) {
    const isolate = new ivm.Isolate({ memoryLimit: memoryMb });
    const context = isolate.createContextSync();
    return {
      load(js, filename) {
        isolate.compileScriptSync(js, { filename }).runSync(context);
      },
      bridge(fns) {
        context.global.setSync("__callRef", new ivm.Reference((s: string) => fns.call(s)));
        context.global.setSync("__flushRef", new ivm.Reference((s: string) => fns.flush(s)));
        isolate
          .compileScriptSync(
            `(function (callRef, flushRef) {
              globalThis.__host = {
                call: (s) => callRef.apply(undefined, [s], { result: { promise: true } }),
                flush: (s) => flushRef.applySync(undefined, [s]),
              };
            })(__callRef, __flushRef);
            delete globalThis.__callRef; delete globalThis.__flushRef;`,
            { filename: "bridge.js" },
          )
          .runSync(context);
      },
      run: (expr) => context.eval(expr, { promise: true, copy: true, filename: "run.js" }) as unknown as Promise<string>,
      dispose() {
        if (!isolate.isDisposed) isolate.dispose();
      },
      get disposed() {
        return isolate.isDisposed;
      },
    };
  },
};
