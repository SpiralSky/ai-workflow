import { objectSchema, type ToolDef } from "../../types.ts";
import { fixtureResult } from "./fixtures.ts";

/** `metrics`: fixture-backed `external` tool (tool-catalog §5); no real network or side effects. */
export const metrics: ToolDef = {
  name: "metrics",
  description: "Query a time-series metric for a service over a recent window and return summary statistics and points.",
  parameters: objectSchema(
    {
      service: { type: "string", description: "Service name." },
      metric: { type: "string", description: "Metric name, e.g. latency_p95 or error_rate." },
      window: { type: "string", description: "Look-back window, e.g. 1h (default 1h)." },
    },
    ["service", "metric"],
  ),
  returns: "{ service: string; metric: string; unit: string; avg: number; max: number; points: [string, number][] }",
  meta: {
    whenToUse: "Check how a service is performing: latency, error rate or throughput over recent time.",
    whenNotToUse: "Not for raw log lines (use containerLogs).",
    examples: ["p95 latency of the api over the last hour", "error rate for the worker"],
    category: "external",
    effect: "external",
    requires: [],
    cost: 3,
  },
  async fn(args: { service: string; metric: string; window?: string }) {
    return fixtureResult("metrics", args);
  },
};
