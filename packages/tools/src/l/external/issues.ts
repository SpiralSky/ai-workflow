import { objectSchema, type ToolDef } from "../../types.ts";
import { fixtureResult } from "./fixtures.ts";

/** `issues`: fixture-backed `external` tool (tool-catalog §5); no real network or side effects. */
export const issues: ToolDef = {
  name: "issues",
  description: "Search, read or comment on issues in the team's issue tracker. op is search (query), get (id) or comment (id, body).",
  parameters: objectSchema(
    {
      op: { type: "string", description: "search, get or comment.", enum: ["search", "get", "comment"] },
      query: { type: "string", description: "Search text (op search)." },
      id: { type: "string", description: "Issue key, e.g. PROJ-123 (get, comment)." },
      body: { type: "string", description: "Comment text (op comment)." },
    },
    ["op"],
  ),
  returns: "{ issues?: { id: string; title: string; status: string; assignee: string }[]; issue?: object; commentId?: string }",
  meta: {
    whenToUse: "Look up or discuss a ticket in the issue tracker: its description, status, assignee or comments.",
    whenNotToUse: "Not for code search (use grep) or commit history (use history).",
    examples: ["find open issues about login timeouts", "read issue PROJ-123"],
    category: "external",
    effect: "external",
    requires: [],
    cost: 2,
  },
  async fn(args: { op: string; query?: string; id?: string; body?: string }) {
    return fixtureResult("issues", args);
  },
};
