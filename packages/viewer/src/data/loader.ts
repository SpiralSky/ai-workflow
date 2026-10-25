/**
 * Script-tag data loader for the viewer.
 * Injects <script> tags to load data files and resolves promises when
 * window.__aiw.register is called by the loaded script.
 */

import type { AIWGlobal } from "../types.js";

/** Initialises window.__aiw if not already present. */
function ensureGlobal(): void {
  if (window.__aiw) return;
  const _data = new Map<string, unknown>();
  const _waiters = new Map<string, Array<(v: unknown) => void>>();
  const global: AIWGlobal = {
    _data,
    _waiters,
    register(key: string, data: unknown) {
      _data.set(key, data);
      const waiters = _waiters.get(key);
      if (waiters) {
        for (const resolve of waiters) resolve(data);
        _waiters.delete(key);
      }
    },
  };
  window.__aiw = global;
}

/**
 * Injects a <script> tag for `src` and returns a promise that resolves
 * when window.__aiw.register(key, …) is called.
 * @param src - URL of the data script to load
 * @param key - registration key to wait for
 */
export function loadScript(src: string, key: string): Promise<unknown> {
  ensureGlobal();
  const existing = window.__aiw._data.get(key);
  if (existing !== undefined) return Promise.resolve(existing);

  return new Promise<unknown>((resolve, reject) => {
    const waiters = window.__aiw._waiters.get(key) ?? [];
    waiters.push(resolve);
    window.__aiw._waiters.set(key, waiters);

    // Check again after registering waiter (race guard)
    const already = window.__aiw._data.get(key);
    if (already !== undefined) {
      window.__aiw._waiters.delete(key);
      resolve(already);
      return;
    }

    const existing = document.querySelector(`script[data-aiw-key="${CSS.escape(key)}"]`);
    if (existing) return; // already injected, waiter will fire when it loads

    const el = document.createElement("script");
    el.src = src;
    el.dataset.aiwKey = key;
    el.onerror = () => reject(new Error(`Failed to load data script: ${src}`));
    document.head.appendChild(el);
  });
}

/**
 * Loads the run index from dist/data/index.js.
 * @returns the index data registered under key "index"
 */
export async function loadIndex(): Promise<unknown> {
  return loadScript("./data/index.js", "index");
}

/**
 * Loads job data for a specific run and job.
 * @param runId - run id (e.g. "2026-10-25T06-53-02Z-f8fd")
 * @param jobName - job directory name (e.g. "01-chunk-off-by-one.baseline.0")
 */
export async function loadJob(runId: string, jobName: string): Promise<unknown> {
  const key = `job:${runId}/${jobName}`;
  const src = `./data/jobs/${encodeURIComponent(runId)}/${encodeURIComponent(jobName)}.js`;
  return loadScript(src, key);
}
