import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolEnv } from "./env.ts";
import { relPath, resolveInRoot } from "./paths.ts";
import { walk } from "./search.ts";

/** Pristine copy of the workspace taken at server startup (tool-catalog §3, `vcs`). */
export interface Snapshot {
  /** Absolute path of the tar archive, in a temp directory outside the workspace. */
  archive: string;
  /** Sorted root-relative paths of the regular files in the pristine workspace. */
  list(): Promise<string[]>;
  /** Pristine bytes of a root-relative file, or null if it did not exist at snapshot time. */
  read(path: string): Promise<Buffer | null>;
  /** Pristine file mode of a root-relative file (e.g. 0o644), or null if absent. */
  mode(path: string): Promise<number | null>;
  /** Deletes the temp directory (also done synchronously at process exit). */
  dispose(): void;
}

/** Runs `tar` with the given args (no shell). Exit code 1 ("file changed while reading") is tolerated. */
function runTar(args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("tar", args, { env: toolEnv(), stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => (err += d));
    child.on("error", reject);
    child.on("close", (code) => (code === 0 || code === 1 ? resolve() : reject(new Error(`tar failed: ${err.trim()}`))));
  });
}

/**
 * Records the workspace as a tar archive (excluding `.git` and `node_modules`) in a fresh directory
 * under `os.tmpdir()`. Files are extracted lazily, once, on the first `list`/`read`, into the same
 * temp directory; the directory is removed by `dispose()` or at process exit.
 * @param root - absolute workspace root
 */
export async function takeSnapshot(root: string): Promise<Snapshot> {
  const dir = mkdtempSync(join(tmpdir(), "aiw-snapshot-"));
  const onExit = () => rmSync(dir, { recursive: true, force: true });
  process.once("exit", onExit);
  try {
    const archive = join(dir, "workspace.tar");
    await runTar(["-C", root, "--exclude=.git", "--exclude=node_modules", "-cf", archive, "."]);
    const files = join(dir, "files");
    let extracted: Promise<void> | undefined;
    const extract = () =>
      (extracted ??= mkdir(files).then(() => runTar(["-C", files, "-xf", archive])));
    return {
      archive,
      async list() {
        await extract();
        return [...walk(files)].map((abs) => relPath(files, abs)).sort();
      },
      async read(path) {
        await extract();
        return await readFile(resolveInRoot(files, path)).catch((e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT" || e.code === "EISDIR") return null;
          throw e;
        });
      },
      async mode(path) {
        await extract();
        return await stat(resolveInRoot(files, path)).then((s) => s.mode & 0o777, () => null);
      },
      dispose() {
        process.off("exit", onExit);
        rmSync(dir, { recursive: true, force: true });
      },
    };
  } catch (e) {
    onExit();
    process.off("exit", onExit);
    throw e;
  }
}
