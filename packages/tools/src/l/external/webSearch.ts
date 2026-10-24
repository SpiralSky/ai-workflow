import { objectSchema, type ToolDef } from "../../types.ts";
import { fixtureResult } from "./fixtures.ts";

/** `webSearch`: fixture-backed `external` tool (tool-catalog §5); no real network or side effects. */
export const webSearch: ToolDef = {
  name: "webSearch",
  description: "Search the web and return result titles, URLs and snippets.",
  parameters: objectSchema(
    {
      query: { type: "string", description: "Search query." },
      maxResults: { type: "integer", description: "Number of results (default 5)." },
    },
    ["query"],
  ),
  returns: "{ results: { title: string; url: string; snippet: string }[] }",
  meta: {
    whenToUse: "Look something up on the public web: an error message, a library, a standard.",
    whenNotToUse: "Not for internal documentation (use docsSearch) or for code in this workspace (use grep).",
    examples: ["search for a library's migration guide", "look up an error message"],
    category: "external",
    effect: "external",
    requires: [],
    cost: 3,
  },
  async fn(args: { query: string; maxResults?: number }) {
    return fixtureResult("webSearch", args);
  },
};
