import { objectSchema, type ToolDef } from "../../types.ts";
import { fixtureResult } from "./fixtures.ts";

/** `containerLogs`: fixture-backed `external` tool (tool-catalog §5); no real network or side effects. */
export const containerLogs: ToolDef = {
  name: "containerLogs",
  description: "Tail recent log lines from a running service container.",
  parameters: objectSchema(
    {
      service: { type: "string", description: "Service or container name." },
      tail: { type: "integer", description: "Number of lines (default 50)." },
      since: { type: "string", description: "Only logs newer than this, e.g. 10m." },
    },
    ["service"],
  ),
  returns: "{ service: string; lines: string[] }",
  meta: {
    whenToUse: "Inspect what a deployed service is logging, for example to see errors after a deploy.",
    whenNotToUse: "Not for output of commands you ran here (use bash) or for metrics (use metrics).",
    examples: ["tail the api container logs", "show errors from the worker in the last 10m"],
    category: "external",
    effect: "external",
    requires: [],
    cost: 3,
  },
  async fn(args: { service: string; tail?: number; since?: string }) {
    return fixtureResult("containerLogs", args);
  },
};
