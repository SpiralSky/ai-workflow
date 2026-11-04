import type { HotPathSnippet } from "./types.ts";

/** Input: state.target (relative .py test file or path#Class.test_method), never an implicit whole-suite target. */
export const snippet: HotPathSnippet = {
  id: "test-failure-summary",
  description: "Run a named test target; on test failure extract failing test names and the first assertion message instead of returning the whole log.",
  tools: ["runTests"],
  outcome: "test-failure",
  code: String.raw`async (tools, state) => {
  const safePath = (p) => typeof p === "string" && p.length > 0 && p.length <= 512 && !/^[\\/]|^[A-Za-z]:|[\x00-\x1f\x7f\\]/.test(p) && !p.split("/").includes("..");
  const validTarget = (t) => typeof t === "string" && t.length <= 512 && safePath(t.split("#")[0]) && /\.py$/.test(t.split("#")[0]) && t.split("#").length <= 2 && (!t.includes("#") || /^[A-Za-z_][A-Za-z0-9_.]*$/.test(t.split("#")[1]));
  const { target } = state;
  if (!validTarget(target)) throw new Error("invalid test target");
  const result = await tools.runTests({ target, timeoutMs: 10000 });
  if (!result.failed.length) return { passed: result.passed, skipped: result.skipped, failed: [], truncated: result.truncated };
  return { passed: result.passed, failures: result.failed.slice(0, 5).map((f) => f.id), omittedVisibleFailures: Math.max(0, result.failed.length - 5), firstAssertion: result.failed[0].message.slice(0, 1000), truncated: result.truncated };
}`,
};
