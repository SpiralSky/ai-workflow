import { objectSchema, type ToolDef } from "../../types.ts";
import { fixtureResult } from "./fixtures.ts";

/** `ciStatus`: fixture-backed `external` tool (tool-catalog §5); no real network or side effects. */
export const ciStatus: ToolDef = {
  name: "ciStatus",
  description: "Latest CI runs for a branch with their status and any failing jobs.",
  parameters: objectSchema(
    {
      branch: { type: "string", description: "Branch name (default main)." },
      limit: { type: "integer", description: "Number of runs to return (default 3)." },
    },
    [],
  ),
  returns: "{ branch: string; runs: { id: number; status: string; commit: string; failingJobs: string[] }[] }",
  meta: {
    whenToUse: "Check whether continuous integration passes for a branch, and which jobs fail.",
    whenNotToUse: "Not for running tests in this workspace (use a test tool or bash).",
    examples: ["is CI green on main", "which job failed on fix/config-missing"],
    category: "external",
    effect: "external",
    requires: [],
    cost: 2,
  },
  async fn(args: { branch?: string; limit?: number }) {
    return fixtureResult("ciStatus", args);
  },
};
