import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildFramework, buildRegistry, type Host } from "@aiw/core";
import { createReporter, NoopSink, FileSink } from "@aiw/telemetry";
import type { FrameworkKind } from "@aiw/core";

/** Parsed variant keys from the --framework flag. */
export interface VariantKeys {
  toolSearch?: boolean;
  catalog?: number;
}

/** Options for `startServer`. */
export interface ServerOptions {
  /** Framework kind (baseline | branch-only | orchestrate). */
  kind: FrameworkKind;
  /** Parsed variant keys. */
  variant?: VariantKeys;
  /** The fully constructed host (local or composite). */
  host: Host;
  /** Path for the JSONL event log; omitted → no file sink. */
  eventsPath?: string;
  /** Branch render mode. */
  branchContext?: "trace" | "annotated" | "full";
  /** Maximum declaration chars cap. */
  maxChars?: number;
  /** Priority tool list for description cap. */
  priority?: string[];
  /** Read-only mode: deny non-read calls before the check step (TODO: wire into CheckedHost). */
  readOnly?: boolean;
}

/**
 * Builds the registry and framework, wires up an MCP stdio server, and starts listening.
 * Progress notifications are throttled to ≤ 2/s (framework-server §2).
 * @param opts - server options
 */
export async function startServer(opts: ServerOptions): Promise<void> {
  // 1. Build host tool list and registry.
  const hostDecls = await opts.host.tools();
  const registry = buildRegistry(hostDecls);

  // 2. Assemble the framework.
  const framework = buildFramework(opts.kind, registry, {
    host: opts.host,
    variant: opts.variant,
    branchContext: opts.branchContext,
    maxChars: opts.maxChars,
    priority: opts.priority,
  });

  // 3. Create MCP Server with instructions set.
  const mcpServer = new Server(
    { name: "aiw-server", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions: framework.instructions || undefined,
    },
  );

  // 4. Advertise framework tools via tools/list.
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: framework.tools.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: t.inputSchema,
    })),
  }));

  // 5. Handle tool calls.
  mcpServer.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const start = Date.now();
    const toolDef = framework.tools.find((t) => t.name === req.params.name);
    if (!toolDef) {
      return {
        content: [{ type: "text", text: `Unknown tool: ${req.params.name}` }],
        isError: true,
        _meta: { "aiw/durationMs": Date.now() - start },
      };
    }

    // Build a reporter for this call.
    const sink = opts.eventsPath ? new FileSink(opts.eventsPath) : new NoopSink();
    const reporter = createReporter({ sink, writer: "s" });

    // Extract telemetry parent from _meta if provided.
    const meta = req.params._meta as Record<string, unknown> | undefined;
    const harnessId = typeof meta?.["aiw/harnessId"] === "string" ? meta["aiw/harnessId"] : undefined;
    const parentId = typeof meta?.["aiw/parent"] === "string" ? meta["aiw/parent"] : undefined;
    void parentId; // reserved for future telemetry correlation
    void harnessId;

    // Abort controller for this call.
    const ac = new AbortController();

    // Throttled progress notification (≤ 2/s).
    const progressToken = meta?.progressToken;
    let lastNotifyMs = 0;
    const THROTTLE_MS = 500;

    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const result = await toolDef.handle(args, {
      reporter,
      signal: ac.signal,
      onEvent: progressToken !== undefined
        ? (e) => {
            const now = Date.now();
            if (now - lastNotifyMs < THROTTLE_MS) return;
            lastNotifyMs = now;
            void extra.sendNotification({
              method: "notifications/progress" as const,
              params: {
                progressToken: progressToken as string | number,
                progress: 0,
                message: `${e.type}`,
              },
            }).catch(() => {});
          }
        : undefined,
    });

    const durationMs = Date.now() - start;
    return {
      content: [{ type: "text", text: result.text }],
      isError: result.isError,
      _meta: { "aiw/durationMs": durationMs },
    };
  });

  // 6. Connect via stdio transport.
  const transport = new StdioServerTransport();
  await mcpServer.connect(transport);
}
