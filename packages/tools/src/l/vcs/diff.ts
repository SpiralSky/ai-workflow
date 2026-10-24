import { renderDiff } from "../../change.ts";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { cutList } from "../../search.ts";
import type { Snapshot } from "../../snapshot.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { MAX_DIFF_OUT, currentFiles, scope } from "./common.ts";

/** Whether a buffer looks binary (NUL in the first 8 KB). */
const isBinary = (b: Buffer) => b.subarray(0, 8192).includes(0);

/**
 * Builds `diff`: status and unified diff of the workspace against the pristine snapshot taken at
 * server startup (so it works without `.git`). Without a snapshot the tool throws `no snapshot`.
 * @param snapshot - the startup snapshot, if the server took one
 */
export function makeDiff(snapshot?: Snapshot): ToolDef {
  return {
    name: "diff",
    description: "Show what changed in the workspace since the job started: per-file status (added, modified, deleted) and a unified diff, for everything or one path.",
    parameters: objectSchema({ path: { type: "string", description: "File or directory to limit to (default: whole workspace)." } }, []),
    returns: "{ status: { path: string; change: 'added' | 'modified' | 'deleted' }[]; diff: string; truncated?: string }",
    meta: {
      whenToUse: "Report or review everything you changed so far, or check what a file looked like before your edits.",
      whenNotToUse: "Not for the history of commits (use history) or for undoing changes (use restore).",
      examples: ["show all my changes so far", "diff src/app.py against the starting state"],
      category: "vcs",
      effect: "read",
      requires: [],
      cost: 2,
    },
    async fn(args: { path?: string }, ctx) {
      if (!snapshot) throw new Error("no snapshot");
      const sc = scope(ctx.root, args.path);
      const pristine = (await snapshot.list()).filter(sc.has);
      const now = currentFiles(ctx.root, sc.has);
      const status: { path: string; change: "added" | "modified" | "deleted" }[] = [];
      const parts: string[] = [];
      for (const path of [...new Set([...pristine, ...now])].sort()) {
        const before = await snapshot.read(path);
        const after = await readFile(join(ctx.root, path)).catch((e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT") return null;
          throw e;
        });
        if (before && after && before.equals(after)) continue;
        if (!before && !after) continue;
        status.push({ path, change: !before ? "added" : !after ? "deleted" : "modified" });
        if ((before && isBinary(before)) || (after && isBinary(after))) parts.push(`Binary files a/${path} and b/${path} differ\n`);
        else parts.push(renderDiff(path, before?.toString("utf8") ?? null, after?.toString("utf8") ?? null));
      }
      const { kept, truncated: listCut } = cutList(status, 200, "pass a path to narrow");
      let diff = parts.join("");
      let diffCut: string | undefined;
      if (Buffer.byteLength(diff) > MAX_DIFF_OUT) {
        let cut = Buffer.from(diff).subarray(0, MAX_DIFF_OUT).toString("utf8");
        cut = cut.slice(0, cut.lastIndexOf("\n") + 1);
        diffCut = `diff cut at ${Buffer.byteLength(cut)} of ${Buffer.byteLength(diff)} bytes; pass path to see one file's diff`;
        diff = cut;
      }
      const truncated = [listCut, diffCut].filter(Boolean).join("; ");
      return truncated ? { status: kept, diff, truncated } : { status: kept, diff };
    },
  };
}
