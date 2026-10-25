/**
 * MCP client for communicating with the in-container server.
 * Runner architecture §4.3, §5.
 */

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/** An MCP tool schema entry from tools/list. */
export interface MCPTool {
  name: string;
  description?: string;
  inputSchema: Record<string, unknown>;
}

/** MCP session handle with the underlying client for tool calls and teardown. */
export interface MCPSession {
  tools: MCPTool[];
  /** @internal */
  _client: Client;
}

/**
 * Opens an MCP session by spawning the server process via stdio transport and
 * performing the MCP initialize handshake + tools/list.
 * @param serverDescriptor - spawn descriptor from startServer (command, args, env)
 * @returns session with the server's tool list and an internal client reference
 */
export async function openMCPSession(serverDescriptor: {
  command: string;
  args: string[];
  env?: Record<string, string>;
}): Promise<MCPSession> {
  const transport = new StdioClientTransport({
    command: serverDescriptor.command,
    args: serverDescriptor.args,
    env: serverDescriptor.env,
    stderr: "pipe",
  });

  const client = new Client({ name: "aiw-runner", version: "1.0.0" });
  await client.connect(transport);

  const result = await client.listTools();
  const tools: MCPTool[] = result.tools.map((t) => ({
    name: t.name,
    description: t.description,
    inputSchema: t.inputSchema as Record<string, unknown>,
  }));

  return { tools, _client: client };
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
 * @param session - MCP session
 * @param name - tool name
 * @param args - tool arguments
 * @param meta - { "aiw/parent": id, "aiw/harnessId": harnessId }
 * @returns tool result with optional timing and infra error
 */
export async function callTool(
  session: MCPSession,
  name: string,
  args: Record<string, unknown>,
  meta: { "aiw/parent": string; "aiw/harnessId": string },
): Promise<MCPCallResult> {
  const result = await session._client.callTool({
    name,
    arguments: { ...args, _meta: meta },
  });

  // Extract aiw metadata from the response _meta if present
  const rawMeta = (result as Record<string, unknown>)._meta as Record<string, unknown> | undefined;
  const durationMs = rawMeta?.["aiw/durationMs"] as number | undefined;
  const infraError = rawMeta?.["aiw/infraError"] as string | undefined;

  return {
    content: result.content as MCPCallResult["content"],
    durationMs,
    infraError,
  };
}

/**
 * Closes the MCP session gracefully.
 * @param session - MCP session to close
 */
export async function closeMCPSession(session: MCPSession): Promise<void> {
  await session._client.close();
}
