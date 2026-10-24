import type { IsolateRuntime } from "../isolate.ts";
import { isolatedVMRuntime, loadIsolatedVM } from "./isolated-vm.ts";
import { quickJSRuntime } from "./quickjs.ts";

export { isolatedVMRuntime, quickJSRuntime };

export type EngineName = "quickjs" | "isolated-vm";

/** True when Node was started with `--no-node-snapshot` (required by isolated-vm on Node 22+). */
export function hasNoNodeSnapshot(): boolean {
  return process.execArgv.includes("--no-node-snapshot") || /(^|\s)--no-node-snapshot(\s|$)/.test(process.env.NODE_OPTIONS ?? "");
}

/**
 * Picks the isolate engine. `auto` prefers isolated-vm when it loads and Node runs with
 * `--no-node-snapshot`, else QuickJS with a `note` on how to get the faster engine.
 * @throws if `pref` is `isolated-vm` and it cannot be used
 */
export async function selectRuntime(
  pref: "auto" | "quickjs" | "isolated-vm",
): Promise<{ runtime: IsolateRuntime; engine: EngineName; note?: string }> {
  if (pref === "quickjs") return { runtime: quickJSRuntime, engine: "quickjs" };
  let failure: string | undefined;
  if (!hasNoNodeSnapshot()) failure = "Node was not started with --no-node-snapshot";
  else {
    try {
      await loadIsolatedVM();
    } catch (e) {
      failure = `isolated-vm could not be loaded (${(e as Error)?.message ?? e})`;
    }
  }
  if (pref === "isolated-vm") {
    if (failure) throw new Error(`engine "isolated-vm" is unavailable: ${failure}. Install isolated-vm for this platform (Node 22 or 24) and start Node with --no-node-snapshot.`);
    return { runtime: isolatedVMRuntime, engine: "isolated-vm" };
  }
  if (failure) {
    return {
      runtime: quickJSRuntime,
      engine: "quickjs",
      note: `using the QuickJS engine (${failure}); for the faster isolated-vm engine install isolated-vm for this platform (Node 22 or 24) and start Node with --no-node-snapshot`,
    };
  }
  return { runtime: isolatedVMRuntime, engine: "isolated-vm" };
}
