import { AsyncLocalStorage } from "node:async_hooks";
import type { Reporter } from "./reporter.ts";

const als = new AsyncLocalStorage<Reporter>();

/**
 * Runs `fn` with `r` as the current reporter for everything it awaits.
 * @param r - reporter to expose via `currentReporter`
 * @param fn - function to run
 */
export function runWithReporter<T>(r: Reporter, fn: () => T): T {
  return als.run(r, fn);
}

/** The reporter of the innermost enclosing `runWithReporter`, if any. */
export function currentReporter(): Reporter | undefined {
  return als.getStore();
}
