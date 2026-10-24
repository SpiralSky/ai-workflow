import { objectSchema, type ToolDef } from "../../types.ts";
import { fixtureResult } from "./fixtures.ts";

/** `docsSearch`: fixture-backed `external` tool (tool-catalog §5); no real network or side effects. */
export const docsSearch: ToolDef = {
  name: "docsSearch",
  description: "Search the team's internal documentation and wiki; returns page titles, links and snippets.",
  parameters: objectSchema(
    {
      query: { type: "string", description: "Search text." },
      space: { type: "string", description: "Wiki space to search, e.g. ENG." },
    },
    ["query"],
  ),
  returns: "{ pages: { title: string; url: string; snippet: string }[] }",
  meta: {
    whenToUse: "Find internal guidelines, runbooks or design notes written by the team.",
    whenNotToUse: "Not for public web content (use webSearch) or code in the workspace (use grep).",
    examples: ["find the deployment runbook", "search the wiki for the on-call policy"],
    category: "external",
    effect: "external",
    requires: [],
    cost: 2,
  },
  async fn(args: { query: string; space?: string }) {
    return fixtureResult("docsSearch", args);
  },
};
