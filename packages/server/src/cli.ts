#!/usr/bin/env node
/**
 * aiw-server CLI entry point.
 * Parses flags and starts the stdio MCP server (framework-server §1).
 *
 * Usage:
 *   aiw-server --framework <variant> --host local|fallback
 *              [--tier S|L] [--root <dir>] [--engine quickjs|isolated-vm|auto]
 *              [--events <path>] [--transcript <path>] [--blobs <dir>]
 *              [--read-only]
 *              [--max-chars N] [--priority <tool>,...]
 *              [--executor-model <m>] [--secondary-cap N] [--branch-context trace|annotated|full]
 */

import { parseArgs } from "node:util";
import { LocalHost } from "./local.ts";
import { startServer } from "./server.ts";
import { parseFrameworkVariant, selectRuntime } from "@aiw/core";

const { values } = parseArgs({
  options: {
    engine: { type: "string", default: "quickjs" },
    framework: { type: "string", default: "branch-only" },
    host: { type: "string", default: "local" },
    tier: { type: "string", default: "S" },
    root: { type: "string", default: process.cwd() },
    events: { type: "string" },
    transcript: { type: "string" },
    blobs: { type: "string" },
    "read-only": { type: "boolean", default: false },
    "max-chars": { type: "string" },
    priority: { type: "string" },
    "executor-provider": { type: "string", default: "openrouter" },
    "executor-model": { type: "string" },
    "executor-api-key": { type: "string" },
    "executor-base-url": { type: "string" },
    "secondary-cap": { type: "string" },
    "branch-context": { type: "string" },
  },
  strict: false,
});

const { kind, variant } = parseFrameworkVariant(String(values.framework ?? "branch-only"));
// Honor explicit engine requests before host/MCP startup; native failures never downgrade.
const enginePreference = values.engine;
if (enginePreference !== "quickjs" && enginePreference !== "isolated-vm" && enginePreference !== "auto") {
  throw new Error(`Unsupported engine: ${String(enginePreference)}; expected quickjs, isolated-vm, or auto`);
}
const selected = await selectRuntime(enginePreference);
console.error(`aiw-server: engine=${selected.engine}${selected.note ? ` (${selected.note})` : ""}`);
const tier = String(values.tier ?? "S") === "L" ? "L" : "S";
const root = String(values.root ?? process.cwd());
const hostMode = String(values.host ?? "local");
const eventsPath = typeof values.events === "string" ? values.events : undefined;
const readOnly = Boolean(values["read-only"]);
const maxCharsRaw = typeof values["max-chars"] === "string" ? parseInt(values["max-chars"] as string, 10) : undefined;
const maxChars = maxCharsRaw && !isNaN(maxCharsRaw) ? maxCharsRaw : undefined;
const priorityStr = typeof values.priority === "string" ? values.priority : undefined;
const priority = priorityStr ? priorityStr.split(",").filter(Boolean) : undefined;
const branchContextRaw = typeof values["branch-context"] === "string" ? values["branch-context"] : undefined;
const branchContext = (branchContextRaw === "trace" || branchContextRaw === "annotated" || branchContextRaw === "full")
  ? branchContextRaw
  : undefined;
const executorProvider = String(values["executor-provider"] ?? "openrouter");
if (executorProvider !== "openrouter" && executorProvider !== "host") throw new Error("Unknown executor provider");
const executorModel = typeof values["executor-model"] === "string" ? values["executor-model"] : undefined;
const executorApiKey = typeof values["executor-api-key"] === "string"
  ? values["executor-api-key"]
  : (process.env["OPENROUTER_API_KEY"] ?? process.env["OPENAI_API_KEY"]);
const executorBaseURL = typeof values["executor-base-url"] === "string"
  ? values["executor-base-url"]
  : process.env["OPENAI_BASE_URL"];
const secondaryCapRaw = typeof values["secondary-cap"] === "string" ? parseInt(values["secondary-cap"] as string, 10) : undefined;
const secondaryCap = secondaryCapRaw !== undefined && !isNaN(secondaryCapRaw) ? secondaryCapRaw : undefined;

// Build host based on --host flag.
let host;
if (hostMode === "local") {
  host = new LocalHost(tier, { root });
} else if (hostMode === "fallback") {
  // TODO: implement fallback host with CheckedHost(PolicyChecker, CompositeHost([LocalHost, ...McpClientHosts]))
  // For now fall back to local.
  console.error("aiw-server: --host fallback is not yet implemented; using local");
  host = new LocalHost(tier, { root });
} else {
  console.error(`aiw-server: unknown --host "${hostMode}"; using local`);
  host = new LocalHost(tier, { root });
}

// TODO: --transcript, --blobs, --policy, --adapter, --mcp-config, --allow-server, --deny-server
// are parsed but not yet wired into the server.
void values.transcript;
void values.blobs;

startServer({
  runtime: selected.runtime,
  kind,
  variant,
  host,
  eventsPath,
  branchContext,
  maxChars,
  priority,
  readOnly,
  orchestrateModel: executorModel,
  orchestrateProvider: executorProvider,
  orchestrateApiKey: executorApiKey,
  orchestrateBaseURL: executorBaseURL,
  orchestrateWorkspaceRoot: root,
  secondaryCap,
}).catch((err) => {
  console.error("aiw-server: fatal error:", err);
  process.exit(1);
});
