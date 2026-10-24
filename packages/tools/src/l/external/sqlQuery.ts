import { objectSchema, type ToolDef } from "../../types.ts";
import { fixtureResult } from "./fixtures.ts";

/** `sqlQuery`: fixture-backed `external` tool (tool-catalog §5); no real network or side effects. */
export const sqlQuery: ToolDef = {
  name: "sqlQuery",
  description: "Run a read-only SQL query (SELECT, WITH, EXPLAIN) against the application database and return rows.",
  parameters: objectSchema(
    {
      sql: { type: "string", description: "Read-only SQL statement." },
      limit: { type: "integer", description: "Max rows returned (default 50)." },
    },
    ["sql"],
  ),
  returns: "{ columns: string[]; rows: unknown[][]; rowCount: number }",
  meta: {
    whenToUse: "Inspect application data in the database, such as counts or a specific record.",
    whenNotToUse: "Not for changing data, and not for reading files (use readFile).",
    examples: ["count users created this week", "look up an order by id"],
    category: "external",
    effect: "external",
    requires: [],
    cost: 3,
  },
  async fn(args: { sql: string; limit?: number }) {
    if (!/^\s*(select|with|explain|show)\b/i.test(args.sql)) throw new Error("only read-only queries are allowed");
    return fixtureResult("sqlQuery", args);
  },
};
