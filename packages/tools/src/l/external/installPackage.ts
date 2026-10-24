import { objectSchema, type ToolDef } from "../../types.ts";
import { fixtureResult } from "./fixtures.ts";

/** `installPackage`: fixture-backed `external` tool (tool-catalog §5); no real network or side effects. */
export const installPackage: ToolDef = {
  name: "installPackage",
  description: "Install a dependency into the project environment and report the installed version.",
  parameters: objectSchema(
    {
      name: { type: "string", description: "Package name." },
      version: { type: "string", description: "Version or specifier (default latest)." },
      ecosystem: { type: "string", description: "pypi or npm (default pypi).", enum: ["pypi", "npm"] },
    },
    ["name"],
  ),
  returns: "{ name: string; version: string; installed: boolean; log: string }",
  meta: {
    whenToUse: "Add a missing third-party dependency to the environment.",
    whenNotToUse: "Not for checking versions first (use packageInfo); the workspace is offline otherwise.",
    examples: ["install requests", "install pytest 8.3.2"],
    category: "external",
    effect: "external",
    requires: [],
    cost: 3,
  },
  async fn(args: { name: string; version?: string; ecosystem?: string }) {
    return fixtureResult("installPackage", args);
  },
};
