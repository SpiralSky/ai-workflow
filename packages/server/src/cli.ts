#!/usr/bin/env node
/**
 * aiw-server CLI entry point.
 * Parses flags and starts the stdio MCP server (framework-server §1).
 *
 * Usage:
 *   aiw-server --framework <variant> --host local|fallback
 *              [--tier S|L] [--root <dir>]
 *              [--events <path>] [--transcript <path>] [--blobs <dir>]
 *              [--read-only]
 *              [--max-chars N] [--priority <tool>,...]
 *              [--executor-model <m>] [--secondary-cap N] [--branch-context trace|annotated|full]
 */

import { parseArgs } from "node:util";
import { LocalHost } from "./local.ts";
import { startServer, type VariantKeys } from "./server.ts";
import type { FrameworkKind } from "@aiw/core";

const { values } = parseArgs({
  options: {
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
    "executor-model": { type: "string" },
    "secondary-cap": { type: "string" },
    "branch-context": { type: "string" },
  },
  strict: false,
});

/**
 * Parses the `--framework` string into a kind and variant keys.
 * Format: `base[key=value,key,...]`, e.g. `branch-only[toolSearch]`, `orchestrate[secondary=2]`.
 * @param raw - raw flag value
 * @returns kind and variant keys
 */
function parseFramework(raw: string): { kind: FrameworkKind; variant: VariantKeys } {
  const bracket = raw.indexOf("[");
  const base = bracket === -1 ? raw : raw.slice(0, bracket);
  const keyStr = bracket === -1 ? "" : raw.slice(bracket + 1).replace(/]$/, "");

  const kind = base as FrameworkKind;
  const variant: VariantKeys = {};
  for (const part of keyStr.split(",").filter(Boolean)) {
    if (part === "toolSearch") variant.toolSearch = true;
    else if (part.startsWith("catalog=")) variant.catalog = parseInt(part.slice(8), 10);
  }
  return { kind, variant };
}

const { kind, variant } = parseFramework(String(values.framework ?? "branch-only"));
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
  kind,
  variant,
  host,
  eventsPath,
  branchContext,
  maxChars,
  priority,
  readOnly,
}).catch((err) => {
  console.error("aiw-server: fatal error:", err);
  process.exit(1);
});
