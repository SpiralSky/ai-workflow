import type { HotPathSnippet } from "./types.ts";

/** Inputs: state.path, state.old, state.new, state.target (explicit narrow .py test file or id). */
export const snippet: HotPathSnippet = {
  id: "edit-then-narrow-test",
  description: "Apply an explicitly specified exact edit then verify only the named narrow test; report the first failure without speculative repair.",
  tools: ["edit", "readFile", "runTests"],
  outcome: "test-failure",
  code: String.raw`async (tools, state) => {
  const safePath = (p) => typeof p === "string" && p.length > 0 && p.length <= 512 && !/^[\\/]|^[A-Za-z]:|[\x00-\x1f\x7f\\]/.test(p) && !p.split("/").includes("..");
  const validTarget = (t) => typeof t === "string" && t.length <= 512 && safePath(t.split("#")[0]) && /\.py$/.test(t.split("#")[0]) && t.split("#").length <= 2 && (!t.includes("#") || /^[A-Za-z_][A-Za-z0-9_.]*$/.test(t.split("#")[1]));
  const { path, old, new: replacement, target } = state;
  if (!safePath(path) || /(?:^|\/)\.?$/.test(path) || typeof old !== "string" || !old || old.length > 8000 || typeof replacement !== "string" || replacement.length > 8000 || !validTarget(target)) throw new Error("invalid edit or test inputs");
  const change = await tools.edit({ path, old, new: replacement });
  const result = await tools.runTests({ target, timeoutMs: 10000 });
  return { change, passed: result.passed, failures: result.failed.slice(0, 5).map((f) => f.id), omittedVisibleFailures: Math.max(0, result.failed.length - 5), firstAssertion: result.failed.length ? result.failed[0].message.slice(0, 1000) : null, truncated: result.truncated };
}`,
};
