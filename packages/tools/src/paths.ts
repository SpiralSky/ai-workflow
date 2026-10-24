import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";

/** Whether `p` is `root` or lies under it (lexically). */
function inside(root: string, p: string): boolean {
  const rel = relative(root, p);
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * Resolves a tool path argument against the workspace root and rejects anything that escapes it,
 * including through symlinks (the nearest existing ancestor is realpath'd).
 * @param root - absolute workspace root
 * @param p - relative or absolute path from the caller
 * @returns the absolute path (lexical, not symlink-resolved)
 * @throws `path outside workspace: <p>`
 */
export function resolveInRoot(root: string, p: string): string {
  const abs = resolve(root, p);
  const realRoot = realpathSync(root);
  let probe = abs;
  while (!existsSync(probe)) {
    const up = dirname(probe);
    if (up === probe) break;
    probe = up;
  }
  const real = realpathSync(probe);
  if (!inside(realRoot, real) || !inside(resolve(root), abs)) throw new Error(`path outside workspace: ${p}`);
  return abs;
}

/**
 * Root-relative path for output, always with `/` separators (`.` for the root itself).
 * @param root - absolute workspace root
 * @param abs - absolute path inside root
 */
export function relPath(root: string, abs: string): string {
  const rel = relative(root, abs);
  return rel === "" ? "." : rel.split(sep).join("/");
}
