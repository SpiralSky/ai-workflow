import { objectSchema, type ToolDef } from "../../types.ts";
import { fixtureResult } from "./fixtures.ts";

/** `httpRequest`: fixture-backed `external` tool (tool-catalog §5); no real network or side effects. */
export const httpRequest: ToolDef = {
  name: "httpRequest",
  description: "Make an HTTP request to a service and return status, headers and body.",
  parameters: objectSchema(
    {
      method: { type: "string", description: "GET, POST, PUT, PATCH or DELETE (default GET).", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
      url: { type: "string", description: "Full URL of the request." },
      headers: { type: "object", description: "Request headers as name/value pairs.", additionalProperties: { type: "string" } },
      body: { type: "string", description: "Request body text." },
    },
    ["url"],
  ),
  returns: "{ status: number; headers: Record<string, string>; body: string }",
  meta: {
    whenToUse: "Call an HTTP API or service endpoint, such as a health check or a REST resource.",
    whenNotToUse: "Not for reading a web page as text (use fetchUrl) or searching the web (use webSearch).",
    examples: ["GET the service health endpoint", "POST a JSON payload to an API"],
    category: "external",
    effect: "external",
    requires: [],
    cost: 3,
  },
  async fn(args: { method?: string; url: string; headers?: Record<string, string>; body?: string }) {
    return fixtureResult("httpRequest", args);
  },
};
