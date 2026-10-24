import { objectSchema, type ToolDef } from "../../types.ts";
import { fixtureResult } from "./fixtures.ts";

/** `pullRequests`: fixture-backed `external` tool (tool-catalog §5); no real network or side effects. */
export const pullRequests: ToolDef = {
  name: "pullRequests",
  description: "List pull requests or read one with its review comments. op is list (state), get (number) or comments (number).",
  parameters: objectSchema(
    {
      op: { type: "string", description: "list, get or comments.", enum: ["list", "get", "comments"] },
      number: { type: "integer", description: "Pull request number (get, comments)." },
      state: { type: "string", description: "open, closed or all for op list (default open).", enum: ["open", "closed", "all"] },
    },
    ["op"],
  ),
  returns: "{ pullRequests?: { number: number; title: string; author: string; state: string }[]; pullRequest?: object; comments?: object[] }",
  meta: {
    whenToUse: "Read pull requests or code review comments from the code host.",
    whenNotToUse: "Not for local changes (use diff) or commit history (use history).",
    examples: ["list open pull requests", "read the review comments on PR 212"],
    category: "external",
    effect: "external",
    requires: [],
    cost: 2,
  },
  async fn(args: { op: string; number?: number; state?: string }) {
    return fixtureResult("pullRequests", args);
  },
};
