import { objectSchema, type ToolDef } from "../../types.ts";
import { fixtureResult } from "./fixtures.ts";

/** `featureFlags`: fixture-backed `external` tool (tool-catalog §5); no real network or side effects. */
export const featureFlags: ToolDef = {
  name: "featureFlags",
  description: "Read or set feature flags. op is list, get (flag) or set (flag, enabled).",
  parameters: objectSchema(
    {
      op: { type: "string", description: "list, get or set.", enum: ["list", "get", "set"] },
      flag: { type: "string", description: "Flag name (get, set)." },
      enabled: { type: "boolean", description: "New value (op set)." },
    },
    ["op"],
  ),
  returns: "{ flags?: { name: string; enabled: boolean }[]; flag?: { name: string; enabled: boolean; rollout: number }; updated?: boolean }",
  meta: {
    whenToUse: "See which feature flags are on or change one for an environment.",
    whenNotToUse: "Not for settings stored in the workspace's config files (use readFile or edit).",
    examples: ["list all feature flags", "turn on new-checkout"],
    category: "external",
    effect: "external",
    requires: [],
    cost: 2,
  },
  async fn(args: { op: string; flag?: string; enabled?: boolean }) {
    return fixtureResult("featureFlags", args);
  },
};
