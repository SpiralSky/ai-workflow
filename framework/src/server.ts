// MCP stdio server exposing the `branch` tool (branch mode) and/or `delegate` tool (orchestrate mode).
import { readFileSync, mkdirSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { trace } from "./trace.js";
import { runBranch } from "./runner.js";
import { handleDelegate } from "./delegate.js";
import type { Session } from "./helpers.js";
import { recordTests } from "./report.js";

export const RETURN_USER_MARKER = "<<RETURN_USER>>";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Short on purpose: Claude Code truncates long MCP descriptions. Full API is in the system prompt (bin/build-prompt).
const description = "Run a short async TS program that calls helper functions (bash, readFile, edit, runTests, classify, llm, returnUser, ...). " +
  "Only the return value + a path summary come back. Full helper API and rules: see 'Branch tool' in the system prompt.";

const traceDir = process.env.BRANCH_TRACE_DIR ?? join(homedir(), ".claude", "branch-traces");
mkdirSync(traceDir, { recursive: true });
const session: Session = {
  cwd: process.env.BRANCH_CWD ?? process.cwd(),
  handles: new Map(),
  state: {},
  traceFile: join(traceDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}.jsonl`),
};

// un-awaited helper promises that reject must not kill the server
process.on("unhandledRejection", (e) => { trace(session, { type: "unhandledRejection", error: String((e as any)?.message ?? e) }); console.error("unhandledRejection:", e); });

const mode = process.env.BRANCH_MODE ?? "branch";
const server = new McpServer({ name: "branch", version: "0.1.0" });

if (mode === "branch" || mode === "both") {
  server.registerTool(
    "branch",
    {
      title: "Branch",
      description,
      inputSchema: {
        intent: z.string().describe("What this program does, <=12 words, shown to the user."),
        code: z.string().describe("Async TS program body."),
      },
      annotations: { title: "Branch" },
    },
    async ({ intent, code }) => {
      const flagFile = process.env.BRANCH_TOGGLE_FLAG ?? join(homedir(), ".claude", "branch-flag");
      if (!existsSync(flagFile)) {
        return { content: [{ type: "text", text: "Branch mode is disabled. Run /branch to enable it for this session." }] };
      }
      const r = await runBranch(code, session, undefined, intent);
      if (r.kind !== "error" && session.lastTests !== undefined) { recordTests(session.cwd, session.lastTests); session.lastTests = undefined; }
      const userMsg = r.kind === "user" ? r.text : "";
      if (r.kind === "user") trace(session, { type: "final", text: userMsg });
      const text =
        r.kind === "user" ? `${RETURN_USER_MARKER}\n${userMsg}\n${r.path}\n(Delivered to user. Do not repeat it; end your turn.)`
        : r.kind === "error" ? `ERROR: ${r.text}\n${r.path}`
        : `${r.text}\n${r.path}\n(Returned — no changes delivered yet. Call branch again to apply changes, or returnUser once done.)`;
      return { content: [{ type: "text", text }], isError: r.kind === "error" };
    },
  );
}

if (mode === "orchestrate" || mode === "both") {
  const delegateDescription =
    "Delegate a coding task to the execution layer. Returns a report of what was accomplished. " +
    "Full spec: see 'Delegate tool' in the system prompt.";
  server.registerTool(
    "delegate",
    {
      title: "Delegate",
      description: delegateDescription,
      inputSchema: {
        task: z.string().describe("What to accomplish. Include relevant file paths and context."),
        policy: z.string().optional().describe("Optional stop/escalation conditions in plain text."),
      },
      annotations: { title: "Delegate" },
    },
    async ({ task, policy }) => {
      const report = await handleDelegate(task, policy, session);
      trace(session, { type: "delegate", task, reportChars: report.length });
      return { content: [{ type: "text", text: report }] };
    },
  );
}

await server.connect(new StdioServerTransport());
