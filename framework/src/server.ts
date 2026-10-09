// MCP stdio server exposing the `branch` tool.
import { readFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { trace } from "./trace.js";
import { runBranch } from "./runner.js";
import type { Session } from "./helpers.js";
import { recordTests } from "./report.js";

export const RETURN_USER_MARKER = "<<RETURN_USER>>";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");
// Short on purpose: Claude Code truncates long MCP descriptions. Full API is in the system prompt (bin/build-prompt).
const description = "Run a short async TS program that calls helper functions (bash, readFile, edit, runTests, classify, llm, returnUser, ...). " +
  "Only the return value + a path summary come back. Full helper API and rules: see 'Branch tool' in the system prompt.";

const traceDir = process.env.BRANCH_TRACE_DIR ?? join(tmpdir(), "branch-traces");
mkdirSync(traceDir, { recursive: true });
const session: Session = {
  cwd: process.env.BRANCH_CWD ?? process.cwd(),
  handles: new Map(),
  state: {},
  traceFile: join(traceDir, `${new Date().toISOString().replace(/[:.]/g, "-")}-${process.pid}.jsonl`),
};

const server = new McpServer({ name: "branch", version: "0.1.0" });
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
    const r = await runBranch(code, session, undefined, intent);
    if (session.lastTests !== undefined) { recordTests(session.cwd, session.lastTests); session.lastTests = undefined; } // hooks read it for the report
    const userMsg = r.kind === "user" ? r.text : "";
    if (r.kind === "user") trace(session, { type: "final", text: userMsg }); // eval reads the delivered message from here (report block: hook trace)
    const text =
      r.kind === "user" ? `${RETURN_USER_MARKER}\n${userMsg}\n${r.path}\n(Delivered to user. Do not repeat it; end your turn.)`
      : r.kind === "error" ? `ERROR: ${r.text}\n${r.path}`
      : `${r.text}\n${r.path}`;
    return { content: [{ type: "text", text }], isError: r.kind === "error" };
  },
);
await server.connect(new StdioServerTransport());
