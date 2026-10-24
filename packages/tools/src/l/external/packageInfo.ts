import { objectSchema, type ToolDef } from "../../types.ts";
import { fixtureResult } from "./fixtures.ts";

/** `packageInfo`: fixture-backed `external` tool (tool-catalog §5); no real network or side effects. */
export const packageInfo: ToolDef = {
  name: "packageInfo",
  description: "Latest versions, release notes summary and documentation link for a dependency.",
  parameters: objectSchema(
    {
      name: { type: "string", description: "Package name, e.g. requests." },
      ecosystem: { type: "string", description: "pypi or npm (default pypi).", enum: ["pypi", "npm"] },
    },
    ["name"],
  ),
  returns: "{ name: string; latest: string; versions: string[]; changelog: string; docs: string }",
  meta: {
    whenToUse: "Check which versions of a dependency exist and what changed, before choosing or upgrading one.",
    whenNotToUse: "Not for installing it (use installPackage) or for reading its source in this workspace (use readFile).",
    examples: ["latest version of requests", "changelog for pytest"],
    category: "external",
    effect: "external",
    requires: [],
    cost: 2,
  },
  async fn(args: { name: string; ecosystem?: string }) {
    return fixtureResult("packageInfo", args);
  },
};
