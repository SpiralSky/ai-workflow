import type { Sidecar } from "../../sidecar.ts";
import type { ToolDef } from "../../types.ts";
import { makeCheck } from "./check.ts";
import { makeFormat } from "./format.ts";

/** The `check` group (`check`, `format`) bound to a sidecar. */
export function checkTools(sc?: Sidecar): ToolDef[] {
  return [makeCheck(sc), makeFormat(sc)];
}
