import { selectRuntime } from "../src/branch/index.ts";

/** Engine under test, from `AIW_ENGINE` (default `quickjs`). */
export const engine = await selectRuntime((process.env.AIW_ENGINE ?? "quickjs") as "quickjs" | "isolated-vm");
export const runtime = engine.runtime;
