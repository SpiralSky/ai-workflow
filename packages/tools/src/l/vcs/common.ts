import { spawn } from "node:child_process";
import { toolEnv } from "../../env.ts";
import { walk } from "../../search.ts";
import { relPath, resolveInRoot } from "../../paths.ts";
import type { ToolCtx } from "../../types.ts";

/** Largest `diff` text returned by the `diff` tool, in bytes. */
export const MAX_DIFF_OUT = 6000;

/**
 * Root-relative scope of a path argument (`.` for everything) plus a membership test.
 * @throws `path outside workspace: <p>`
 */
export function scope(root: string, p: string | undefined): { rel: string; has(file: string): boolean } {
  const rel = relPath(root, resolveInRoot(root, p ?? "."));
  return { rel, has: (f) => rel === "." || f === rel || f.startsWith(rel + "/") };
}

/** Sorted root-relative regular files currently in the workspace under `has`. */
export function currentFiles(root: string, has: (f: string) => boolean): string[] {
  return [...walk(root)].map((a) => relPath(root, a)).filter(has).sort();
}

/** Result of one git invocation. */
export interface GitResult { code: number; out: string; err: string }

/** Runs `git` (never through a shell) in the workspace root with secrets stripped from the environment. */
export function runGit(ctx: ToolCtx, args: string[]): Promise<GitResult> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["--no-pager", "-c", "core.quotepath=off", ...args], {
      cwd: ctx.root,
      env: toolEnv(ctx.env ?? process.env),
      stdio: ["ignore", "pipe", "pipe"],
      signal: ctx.signal,
    });
    let out = "", err = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (err += d));
    child.on("error", (e) => ((e as NodeJS.ErrnoException).code === "ENOENT" ? resolve({ code: 127, out, err: "git not found" }) : reject(e)));
    child.on("close", (code) => resolve({ code: code ?? 1, out, err }));
  });
}
