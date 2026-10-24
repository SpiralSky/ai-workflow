import { relPath, resolveInRoot } from "../../paths.ts";
import { needSidecar, type Sidecar } from "../../sidecar.ts";
import type { JSONSchema } from "@aiw/core";
import type { ToolCtx } from "../../types.ts";

/** Parameters naming a code position: `symbol`, or `path` with `name` and/or `line`/`col`. */
export const TARGET_PROPS: Record<string, JSONSchema> = {
  symbol: { type: "string", description: "Symbol as path#Name or path#Class.method." },
  path: { type: "string", description: "File path, relative to the workspace root." },
  name: { type: "string", description: "Identifier to look up in path (first occurrence, or on line)." },
  line: { type: "integer", description: "1-based line." },
  col: { type: "integer", description: "1-based column." },
};

/** Cap on list items returned by nav tools (also bounded by bytes via `cutList`). */
export const MAX_ITEMS = 40;

/**
 * Validates every path-like argument against the workspace root (`path`, and the path part of
 * `symbol`) and forwards the call to the sidecar, aborting with the call's signal.
 * @throws `no sidecar`, `path outside workspace: <p>`, or the sidecar's error
 */
export async function navCall(sc: Sidecar | undefined, method: string, args: Record<string, unknown>, ctx: ToolCtx): Promise<any> {
  const sidecar = needSidecar(sc);
  const params = { ...args };
  if (typeof params.path === "string") params.path = relPath(ctx.root, resolveInRoot(ctx.root, params.path));
  if (typeof params.symbol === "string") {
    const [p, ...rest] = params.symbol.split("#");
    if (rest.length) params.symbol = `${relPath(ctx.root, resolveInRoot(ctx.root, p!))}#${rest.join("#")}`;
  }
  return sidecar.call(method, params, ctx.signal);
}
