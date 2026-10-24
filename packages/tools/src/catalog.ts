import { bash } from "./s/bash.ts";
import { edit } from "./s/edit.ts";
import { findFiles } from "./s/findFiles.ts";
import { grep } from "./s/grep.ts";
import { readFile } from "./s/readFile.ts";
import { writeFile } from "./s/writeFile.ts";
import type { ToolDef } from "./types.ts";

/**
 * The registered tools for a tier, in tools.md §5 order.
 * @param tier - `S` (core six) or `L` (not built yet)
 * @param opts - `root`: absolute workspace root (reserved; tools receive it per call via `ToolCtx`)
 * @throws `tier L not built yet`
 */
export function catalog(tier: "S" | "L", opts: { root: string }): ToolDef[] {
  void opts;
  if (tier === "L") {
    // L groups: added in later steps
    throw new Error("tier L not built yet");
  }
  return [bash, readFile, writeFile, edit, grep, findFiles];
}
