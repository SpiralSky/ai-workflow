import { relPath, resolveInRoot } from "../../paths.ts";

/**
 * Normalises `path` or `path#id` so the path part is workspace-relative.
 * @throws `path outside workspace` for a path that escapes the root
 */
export function normTarget(root: string, target: string): string {
  const [path, ...id] = target.split("#");
  return [relPath(root, resolveInRoot(root, path!)), ...id].join("#");
}
