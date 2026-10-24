import { objectSchema, type ToolDef } from "../../types.ts";
import { fixtureResult } from "./fixtures.ts";

/** `fetchUrl`: fixture-backed `external` tool (tool-catalog §5); no real network or side effects. */
export const fetchUrl: ToolDef = {
  name: "fetchUrl",
  description: "Fetch a web page and return its readable text content.",
  parameters: objectSchema(
    {
      url: { type: "string", description: "URL to fetch." },
      maxChars: { type: "integer", description: "Cut the text to this many characters (default 4000)." },
    },
    ["url"],
  ),
  returns: "{ url: string; title: string; text: string }",
  meta: {
    whenToUse: "Read the text of a documentation page, article or other web page by URL.",
    whenNotToUse: "Not for API calls (use httpRequest) or finding pages (use webSearch).",
    examples: ["read the Python docs page for pathlib", "fetch a changelog page"],
    category: "external",
    effect: "external",
    requires: [],
    cost: 3,
  },
  async fn(args: { url: string; maxChars?: number }) {
    return fixtureResult("fetchUrl", args);
  },
};
