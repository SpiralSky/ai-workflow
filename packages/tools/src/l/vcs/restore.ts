import { chmod, mkdir, readFile, readdir, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { mergeSummaries, summarizeChange, type ChangeSummary } from "../../change.ts";
import type { Snapshot } from "../../snapshot.ts";
import { objectSchema, type ToolDef } from "../../types.ts";
import { currentFiles, scope } from "./common.ts";

/**
 * Builds `restore`: puts a file or directory back to its pristine contents from the startup snapshot
 * and deletes files added since. Change summary: one entry per file touched (restored files diff
 * against their current content, deleted files count all lines as removed). Throws `no snapshot`
 * when the server took none.
 * @param snapshot - the startup snapshot, if the server took one
 */
export function makeRestore(snapshot?: Snapshot): ToolDef {
  return {
    name: "restore",
    description: "Undo changes to a file or directory: restore the contents it had when the job started and delete files added since. Returns a change summary.",
    parameters: objectSchema({ path: { type: "string", description: "File or directory to restore, relative to the workspace root." } }, ["path"]),
    returns: "{ files: { path: string; added: number; removed: number }[]; diff?: string }",
    meta: {
      whenToUse: "Throw away a bad edit or an experiment and get a file or directory back to its starting state.",
      whenNotToUse: "Not for removing a file you want gone on purpose (use deleteFile) or for viewing changes (use diff).",
      examples: ["undo my edits to src/app.py", "reset the tests directory to how it started"],
      category: "vcs",
      effect: "write",
      requires: [],
      cost: 2,
    },
    async fn(args: { path: string }, ctx) {
      if (!snapshot) throw new Error("no snapshot");
      const sc = scope(ctx.root, args.path);
      const pristine = (await snapshot.list()).filter(sc.has);
      const now = currentFiles(ctx.root, sc.has);
      const parts: ChangeSummary[] = [];
      for (const path of [...new Set([...pristine, ...now])].sort()) {
        const abs = join(ctx.root, path);
        const before = await snapshot.read(path);
        const cur = await readFile(abs).catch((e: NodeJS.ErrnoException) => {
          if (e.code === "ENOENT") return null;
          throw e;
        });
        if (before && cur && before.equals(cur)) continue;
        if (!before) {
          await rm(abs);
          parts.push(summarizeChange(ctx.root, abs, cur!.toString("utf8"), ""));
          // drop directories emptied by the deletion
          for (let d = dirname(abs); d !== ctx.root && d.startsWith(ctx.root); d = dirname(d)) {
            if ((await readdir(d)).length > 0) break;
            await rmdir(d);
          }
        } else {
          await mkdir(dirname(abs), { recursive: true });
          await writeFile(abs, before);
          const mode = await snapshot.mode(path);
          if (mode !== null) await chmod(abs, mode);
          parts.push(summarizeChange(ctx.root, abs, cur?.toString("utf8") ?? null, before.toString("utf8")));
        }
      }
      return mergeSummaries(parts);
    },
  };
}
