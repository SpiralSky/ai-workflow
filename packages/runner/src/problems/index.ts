/**
 * `aiw problems build` and `aiw problems check` commands.
 * Problems §5–7.
 *
 * TODO: Implement problem workspace construction (build) and self-check (check).
 */

/**
 * Builds problem workspaces for the given problem ids (or all if none given).
 * Creates the workspace directory from the codebase + overlay.
 * @param problemIds - problem ids to build (empty = all)
 * @param problemsDir - path to experiments/problems/
 */
export async function buildProblems(problemIds: string[], problemsDir: string): Promise<void> {
  // TODO: implement per problems.md §5–6
  console.error(`[problems stub] buildProblems: not yet implemented (${problemsDir}, ids: ${problemIds.join(",") || "all"})`);
}

/**
 * Runs the self-check for the given problem ids (or all if none given).
 * @param problemIds - problem ids to check (empty = all)
 * @param problemsDir - path to experiments/problems/
 */
export async function checkProblems(problemIds: string[], problemsDir: string): Promise<void> {
  // TODO: implement per problems.md §7
  console.error(`[problems stub] checkProblems: not yet implemented (${problemsDir}, ids: ${problemIds.join(",") || "all"})`);
}
