import { externalTools } from "./l/external/index.ts";
import { deleteFile } from "./l/fs/deleteFile.ts";
import { listDir } from "./l/fs/listDir.ts";
import { moveFile } from "./l/fs/moveFile.ts";
import { multiEdit } from "./l/fs/multiEdit.ts";
import { makeDiff } from "./l/vcs/diff.ts";
import { history } from "./l/vcs/history.ts";
import { makeRestore } from "./l/vcs/restore.ts";
import { bash } from "./s/bash.ts";
import { edit } from "./s/edit.ts";
import { findFiles } from "./s/findFiles.ts";
import { grep } from "./s/grep.ts";
import { readFile } from "./s/readFile.ts";
import { writeFile } from "./s/writeFile.ts";
import type { Snapshot } from "./snapshot.ts";
import type { ToolDef } from "./types.ts";

/** Options of `catalog`. */
export interface CatalogOpts {
  /** Absolute workspace root (reserved; tools receive it per call via `ToolCtx`). */
  root: string;
  /** Startup snapshot of the workspace; without it `diff` and `restore` throw `no snapshot`. */
  snapshot?: Snapshot;
  /** Internal, for tests: allow tier L with only the groups built so far (fs, vcs, external). */
  partial?: boolean;
}

/**
 * The registered tools for a tier, in tools.md §5–6 order: S, then the L groups
 * (fs, nav, graph, refactor, test, check, vcs, external). The S tools are the same objects in both tiers.
 * @param tier - `S` (core six) or `L` (S plus 47 more; the sidecar groups are not built yet)
 * @param opts - see `CatalogOpts`
 * @throws `tier L not built yet` unless `opts.partial` is set
 */
export function catalog(tier: "S" | "L", opts: CatalogOpts): ToolDef[] {
  const s = [bash, readFile, writeFile, edit, grep, findFiles];
  if (tier === "S") return s;
  // nav, graph, refactor, test, check need the Python sidecar: added in a later step
  if (!opts.partial) throw new Error("tier L not built yet");
  return [
    ...s,
    multiEdit, moveFile, deleteFile, listDir,
    makeDiff(opts.snapshot), history, makeRestore(opts.snapshot),
    ...externalTools,
  ];
}
