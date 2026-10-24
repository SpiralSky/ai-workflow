import { newQuickJSWASMModuleFromVariant, type QuickJSContext, type QuickJSHandle, type QuickJSDeferredPromise, type QuickJSRuntime, type QuickJSWASMModule } from "quickjs-emscripten-core";
import variant from "@jitl/quickjs-singlefile-mjs-release-sync";
import type { HostFns, Isolate, IsolateRuntime } from "../isolate.ts";

let moduleP: Promise<QuickJSWASMModule> | undefined;

/** Loads (once) the single-file WASM build of QuickJS. */
function loadModule(): Promise<QuickJSWASMModule> {
  moduleP ??= newQuickJSWASMModuleFromVariant(variant);
  return moduleP;
}

const MAX_STACK_BYTES = 1024 * 1024;

/**
 * Portable engine: QuickJS compiled to WASM, running on the host thread. Pure JS dependency, so it
 * works on any platform and bundles into a single file. Timeouts rely on the `interrupt` callback
 * (a synchronous loop blocks the host event loop, so timers cannot fire); the interrupt error is
 * catchable inside the script, so the engine records that it fired and fails `run` regardless. Out-of-memory is an ordinary catchable `InternalError`; `run.ts` maps
 * it to the `memory` code when it surfaces as the branch's failure.
 */
export const quickJSRuntime: IsolateRuntime = {
  async create({ memoryMb, interrupt }): Promise<Isolate> {
    const qjs = await loadModule();
    const runtime: QuickJSRuntime = qjs.newRuntime();
    runtime.setMemoryLimit(memoryMb * 1024 * 1024);
    runtime.setMaxStackSize(MAX_STACK_BYTES);
    // The interrupt error is an ordinary catchable InternalError in this build, so a program (or the
    // recorder) can swallow it. Remember that it fired and fail `run` regardless of what the script returns.
    let interrupted = false;
    if (interrupt) {
      runtime.setInterruptHandler(() => {
        if (!interrupt()) return false;
        interrupted = true;
        return true;
      });
    }
    const context: QuickJSContext = runtime.newContext();
    let disposed = false;
    const pending = new Set<QuickJSDeferredPromise>();
    let runHandle: QuickJSHandle | undefined;
    let failRun: ((e: Error) => void) | undefined;

    /** Runs queued promise jobs; an error (e.g. interrupt) aborts the pending `run`. */
    const pump = () => {
      if (disposed) return;
      const r = runtime.executePendingJobs();
      if (r.error) {
        const err = context.dump(r.error);
        r.error.dispose();
        failRun?.(new Error(describe(err)));
      }
    };

    return {
      load(js, filename) {
        const r = context.evalCode(js, filename);
        if (r.error) throw dumpError(context, r.error);
        r.value.dispose();
      },
      bridge(fns: HostFns) {
        const host = context.newObject();
        const callFn = context.newFunction("call", (arg) => {
          const deferred = context.newPromise();
          pending.add(deferred);
          const settle = (fn: () => void) => {
            // late settlements after dispose must not touch freed handles
            if (disposed || !pending.delete(deferred)) return;
            fn();
            deferred.dispose();
            pump();
          };
          let p: Promise<string>;
          try {
            p = Promise.resolve(fns.call(context.getString(arg)));
          } catch (e) {
            p = Promise.reject(e);
          }
          p.then(
            (v) => settle(() => {
              const h = context.newString(v);
              deferred.resolve(h);
              h.dispose();
            }),
            (e) => settle(() => {
              const h = context.newError(String((e as Error)?.message ?? e));
              deferred.reject(h);
              h.dispose();
            }),
          );
          return deferred.handle;
        });
        const flushFn = context.newFunction("flush", (arg) => {
          fns.flush(context.getString(arg));
        });
        context.setProp(host, "call", callFn);
        context.setProp(host, "flush", flushFn);
        context.setProp(context.global, "__host", host);
        callFn.dispose();
        flushFn.dispose();
        host.dispose();
      },
      run(expr) {
        return new Promise<string>((resolve, reject) => {
          if (disposed) return reject(new Error("isolate disposed"));
          failRun = reject;
          const r = context.evalCode(expr, "run.js");
          if (r.error) return reject(dumpError(context, r.error));
          if (interrupted) {
            r.value.dispose();
            return reject(new Error("interrupted"));
          }
          const promiseHandle = r.value;
          runHandle = promiseHandle;
          context.resolvePromise(promiseHandle).then(
            (res) => {
              runHandle = undefined;
              promiseHandle.dispose();
              if (interrupted) {
                if (res.error) res.error.dispose();
                else res.value.dispose();
                return reject(new Error("interrupted"));
              }
              if (res.error) return reject(dumpError(context, res.error));
              try {
                resolve(context.getString(res.value));
              } finally {
                res.value.dispose();
              }
            },
            reject,
          );
          pump();
        });
      },
      dispose() {
        if (disposed) return;
        disposed = true;
        failRun?.(new Error("isolate disposed"));
        for (const d of pending) d.dispose();
        pending.clear();
        runHandle?.dispose();
        try {
          context.dispose();
          runtime.dispose();
        } catch {
          // leaked handles (e.g. a run promise still pending) must not make dispose throw
        }
      },
      get disposed() {
        return disposed;
      },
    };
  },
};

/** Human-readable message of a dumped QuickJS error value. */
function describe(v: unknown): string {
  if (v && typeof v === "object" && "message" in v) {
    const e = v as { name?: string; message: string };
    return e.name && e.name !== "Error" ? `${e.name}: ${e.message}` : e.message;
  }
  return String(v);
}

/** Converts (and disposes) a failed QuickJS result handle into a host `Error`. */
function dumpError(context: QuickJSContext, handle: Parameters<QuickJSContext["dump"]>[0]): Error {
  const v = context.dump(handle);
  handle.dispose();
  return new Error(describe(v));
}
