import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { fromMCPResult, type Host, type HostCallRequest, type HostToolDecl } from "@aiw/core";
import type { CallCtx } from "@aiw/core";

/** Config entry for an MCP server (matching the MCP config file format). */
export interface McpServerConfig {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

/**
 * Implements `Host` over an MCP client connection to a stdio server (framework-server §3).
 * Used for discovered user servers in `fallback` host mode.
 */
export class McpClientHost implements Host {
  private readonly config: McpServerConfig;
  private client?: Client;
  private transport?: StdioClientTransport;

  constructor(config: McpServerConfig) {
    this.config = config;
  }

  /**
   * Spawns the MCP server process and establishes an MCP client connection.
   * Must be called before `tools()` or `call()`.
   */
  async connect(): Promise<void> {
    this.transport = new StdioClientTransport({
      command: this.config.command,
      args: this.config.args,
      env: this.config.env,
    });
    this.client = new Client({ name: "aiw-server", version: "1.0.0" });
    await this.client.connect(this.transport);
  }

  /**
   * Lists the server's tools, converting each to a `HostToolDecl`.
   * Unknown effects default to `write` (core-tools-and-hosts I-10).
   * @returns host tool declarations
   * @throws Error when not connected
   */
  async tools(): Promise<HostToolDecl[]> {
    if (!this.client) throw new Error("McpClientHost: not connected; call connect() first");
    const result = await this.client.listTools();
    return result.tools.map((t) => ({
      name: t.name,
      description: t.description ?? "",
      inputSchema: (t.inputSchema ?? { type: "object", properties: {} }) as Record<string, unknown>,
      // Unknown effect: default to write (framework-server §5, I-10)
      meta: { effect: "write" as const, whenToUse: t.description ?? t.name },
    }));
  }

  /**
   * Calls a tool on the remote MCP server.
   * @param req - call request with tool name and args
   * @param ctx - call context (signal forwarded as MCP cancellation)
   * @returns the tool result text
   * @throws Error when not connected, on MCP error, or transport failure
   */
  async call(req: HostCallRequest, ctx: CallCtx): Promise<unknown> {
    if (!this.client) throw new Error("McpClientHost: not connected; call connect() first");
    const args = typeof req.args === "object" && req.args !== null ? (req.args as Record<string, unknown>) : {};
    const result = await this.client.callTool(
      { name: req.name, arguments: args },
      undefined,
      { signal: ctx.signal },
    );
    return fromMCPResult({
      content: result.content as Array<{ type: string; text?: string }>,
      structuredContent: result.structuredContent,
      isError: result.isError as boolean | undefined,
    });
  }

  /** Closes the MCP client connection. */
  async close(): Promise<void> {
    await this.client?.close();
  }
}
