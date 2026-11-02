/** Exact generated fixture build-context contract, separate from canonical task identity. */
import { openSync, closeSync, fstatSync, readSync, lstatSync, realpathSync, constants } from "node:fs";
import { join, resolve } from "node:path";

export const PROBLEM_DOCKERIGNORE = "*\n!workspace/\n";

/** Refuse absent/broadened/redirected context policy before Docker or evaluation admission. */
export function assertProblemBuildContext(problemDir: string): void {
  try {
    const root = resolve(problemDir);
    if (!lstatSync(root).isDirectory() || realpathSync(root) !== root) throw new Error("unsafe context root");
    // Dockerfile-specific policy takes precedence over the generated root policy; none is authorized.
    try {
      lstatSync(join(root, "Dockerfile.dockerignore"));
      throw new Error("unexpected Dockerfile-specific context policy");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    const expected = Buffer.from(PROBLEM_DOCKERIGNORE);
    const fd = openSync(join(root, ".dockerignore"), constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.size !== expected.length) throw new Error("invalid context policy file");
      const bytes = Buffer.alloc(expected.length + 1);
      let size = 0;
      while (size < bytes.length) {
        const count = readSync(fd, bytes, size, bytes.length - size, null);
        if (!count) break;
        size += count;
      }
      if (size !== expected.length || !bytes.subarray(0, size).equals(expected)) throw new Error("noncanonical context policy");
    } finally { closeSync(fd); }
  } catch {
    throw new Error("problem build-context admission failed: require the exact generated workspace-only .dockerignore and no Dockerfile-specific override; run aiw problems build");
  }
}
