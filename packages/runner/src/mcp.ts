/**
 * MCP client for communicating with the in-container server.
 * Runner architecture §4.3, §5.
 *
 * TODO: All functions are stubs. Implement the MCP protocol over the docker exec stdio transport.
 */

/** An MCP tool schema entry from tools/list. */
export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** A mock MCP session handle. */
export interface MCPSession {
  tools: MCPTool[];
}

/**
 * Opens an MCP session to the running server: calls initialize and tools/list.
 * @param _serverProcess - the stdio transport to the server (docker exec child process)
 * @returns session with the server's tool list
 */
export async function openMCPSession(_serverProcess: unknown): Promise<MCPSession> {
  // TODO: implement MCP initialize + tools/list over stdio transport
  console.error("[mcp stub] openMCPSession: returning mock tool list");
  return {
    tools: [
      {
        name: "readFile",
        description: "Read a file",
        inputSchema: { type: "object", properties: { path: { type: "string" } }, required: ["path"] },
      },
    ],
  };
}

/** Result of a tool call. */
export interface MCPCallResult {
  content: Array<{ type: "text"; text: string }>;
  /** Server-reported execution time. */
  durationMs?: number;
  /** True when the server signals an infra error inside an executor. */
  infraError?: string;
}

/**
 * Calls a tool on the MCP server and returns the result.
 * Passes _meta with parent event id and harness id (runner §4.3).
 * @param _session - MCP session
 * @param name - tool name
 * @param args - tool arguments
 * @param meta - { "aiw/parent": id, "aiw/harnessId": harnessId }
 * @returns tool result with optional timing and infra error
 */
export async function callTool(
  _session: MCPSession,
  name: string,
  args: Record<string, unknown>,
  meta: { "aiw/parent": string; "aiw/harnessId": string },
): Promise<MCPCallResult> {
  // TODO: implement tools/call over the MCP session
  console.error(`[mcp stub] callTool: ${name}(${JSON.stringify(args)}) meta=${JSON.stringify(meta)}`);
  return { content: [{ type: "text", text: `[stub] called ${name}` }], durationMs: 0 };
}

/**
 * Closes the MCP session gracefully.
 * @param _session - MCP session to close
 */
export async function closeMCPSession(_session: MCPSession): Promise<void> {
  // TODO: send shutdown to the server
  console.error("[mcp stub] closeMCPSession");
}
