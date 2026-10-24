import type { Isolate, IsolateRuntime } from "../isolate.ts";

type IVM = typeof import("isolated-vm");
let ivmModule: Promise<IVM> | undefined;

/**
 * Loads `isolated-vm` lazily (it is an optional dependency and needs `--no-node-snapshot` on Node 22+).
 * @throws if the package is missing or its native binding cannot be loaded
 */
export function loadIsolatedVM(): Promise<IVM> {
  ivmModule ??= import("isolated-vm").then((m) => ((m as { default?: IVM }).default ?? (m as unknown as IVM)));
  return ivmModule;
}

/** Fast engine: `isolated-vm` (V8 isolate with a heap limit; no require/process in the context). */
export const isolatedVMRuntime: IsolateRuntime = {
  async create({ memoryMb }): Promise<Isolate> {
    const ivm = await loadIsolatedVM();
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
