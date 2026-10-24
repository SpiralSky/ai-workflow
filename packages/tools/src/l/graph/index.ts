import type { Sidecar } from "../../sidecar.ts";
import type { ToolDef } from "../../types.ts";
import { makeCallGraph } from "./callGraph.ts";
import { makeDataFlow } from "./dataFlow.ts";
import { makeImpact } from "./impact.ts";
import { makeImportGraph } from "./importGraph.ts";
import { makeOverview } from "./overview.ts";

/** The `graph` group in tools.md §6.3 order, bound to a sidecar (tools throw `no sidecar` without one). */
export function graphTools(sc?: Sidecar): ToolDef[] {
  return [makeOverview(sc), makeCallGraph(sc), makeImportGraph(sc), makeImpact(sc), makeDataFlow(sc)];
}
