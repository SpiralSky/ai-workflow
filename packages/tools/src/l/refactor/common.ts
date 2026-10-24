import { join } from "node:path";
import { MAX_DIFF_BYTES, renderDiff, summarizeChange, type ChangeSummary } from "../../change.ts";
import { relPath, resolveInRoot } from "../../paths.ts";
import type { Sidecar } from "../../sidecar.ts";
import type { JSONSchema } from "@aiw/core";
import type { ToolCtx } from "../../types.ts";
import { navCall } from "../nav/common.ts";

/** The `dryRun` parameter shared by every refactoring tool. */
export const DRY_RUN: JSONSchema = { type: "boolean", description: "Return the diff without writing anything (default false)." };

/** Change summary text of the result type, shared by the tools' `returns`. */
export const CHANGE_RETURNS = "files: { path: string; added: number; removed: number }[]; diff?: string; truncated?: string";

/** Largest diff returned by a dry run, in bytes (the 8 KB output cap leaves room for the file list). */
export const MAX_DRY_DIFF_BYTES = 6000;

/** A file as the sidecar reports it: `before` null = created, `after` null = deleted. */
interface FileChange { path: string; before: string | null; after: string | null }

/**
 * Cuts text to at most `max` bytes at a line boundary.
 * @returns the text and whether it was cut
 */
function cutLines(text: string, max: number): [string, boolean] {
  if (Buffer.byteLength(text) <= max) return [text, false];
  const cut = Buffer.from(text).subarray(0, max).toString("utf8");
  return [cut.slice(0, cut.lastIndexOf("\n") + 1), true];
}

/**
 * Turns the sidecar's file changes into the change summary (tools §4). Moved files appear as the old
 * path fully removed and the new path fully added (tool-catalog A-30); created and deleted files
 * count all their lines. A dry run carries the full diff up to ~6 KB, a real run only a small one.
 * @param root - absolute workspace root
 * @param changes - changed files with before/after text
 * @param dryRun - whether nothing was written
 */
export function summarize(root: string, changes: FileChange[], dryRun: boolean): ChangeSummary & { truncated?: string } {
  const files = changes.map((c) => summarizeChange(root, join(root, c.path), c.before, c.after ?? "").files[0]!);
  const full = changes.map((c) => renderDiff(c.path, c.before, c.after)).join("");
  const out: ChangeSummary & { truncated?: string } = { files };
  if (dryRun) {
    const [diff, cut] = cutLines(full, MAX_DRY_DIFF_BYTES);
    out.diff = diff;
    if (cut) out.truncated = `diff cut at ${MAX_DRY_DIFF_BYTES} bytes; the change touches ${files.length} files, use readFile to inspect them after applying`;
  } else if (full && Buffer.byteLength(full) <= MAX_DIFF_BYTES) out.diff = full;
  return out;
}

/**
 * Validates path arguments (`path`, `symbol`, `from`, `to`) against the workspace root, runs the
 * refactoring in the sidecar and returns its change summary plus any extra fields the method reports.
 * @param sc - the sidecar
 * @param method - sidecar method (named like the tool)
 * @param args - tool arguments
 * @throws `no sidecar`, `path outside workspace: <p>`, `unsupported language: <ext>`, or the refactoring's own error (the workspace is then unchanged)
 */
export async function refactorCall(sc: Sidecar | undefined, method: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<any> {
  const params = { ...args };
  for (const k of ["from", "to"]) if (typeof params[k] === "string") params[k] = relPath(ctx.root, resolveInRoot(ctx.root, params[k] as string));
  const { changes, ...extra } = await navCall(sc, method, params, ctx) as { changes: FileChange[] } & Record<string, unknown>;
  return { ...summarize(ctx.root, changes, params.dryRun === true), ...extra };
}
