import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema } from "@modelcontextprotocol/sdk/types.js";
import { buildFramework, buildRegistry, type Host } from "@aiw/core";
import { createReporter, NoopSink, FileSink, fromMeta } from "@aiw/telemetry";
import { createChatClient } from "@aiw/llm";
import type { FrameworkKind } from "@aiw/core";

/** Parsed variant keys shared with runner/core. */
export type VariantKeys = import("@aiw/core").FrameworkVariantKeys;

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
  /** Orchestrate executor: model id (framework-server §5). */
  orchestrateModel?: string;
  /** Orchestrate executor: API key. */
  orchestrateApiKey?: string;
  /** Orchestrate executor: base URL (default: https://openrouter.ai/api/v1). */
  orchestrateBaseURL?: string;
  /** Orchestrate executor: workspace root (default: process.cwd()). */
  orchestrateWorkspaceRoot?: string;
  /** Orchestrate executor: per-executor turn cap (default 4). */
  secondaryCap?: number;
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

  // 2. Build orchestrate options if needed.
  let orchestrateOpts: import("@aiw/core").OrchestrateOptions | undefined;
  if (opts.kind === "orchestrate") {
    if (!opts.orchestrateModel) throw new Error("orchestrate requires --executor-model");
    if (!opts.orchestrateApiKey) throw new Error("orchestrate requires an executor API key (--executor-api-key or OPENROUTER_API_KEY)");
    const client = createChatClient({
      baseURL: opts.orchestrateBaseURL ?? "https://openrouter.ai/api/v1",
      apiKey: opts.orchestrateApiKey,
      timeoutMs: 300_000,
    });
    orchestrateOpts = {
      client,
      model: opts.orchestrateModel,
      workspaceRoot: opts.orchestrateWorkspaceRoot ?? process.cwd(),
      ...(opts.secondaryCap !== undefined ? { turns: opts.secondaryCap } : {}),
    };
  }

  // 3. Assemble the framework.
  const framework = buildFramework(opts.kind, registry, {
    host: opts.host,
    variant: opts.variant,
    branchContext: opts.branchContext,
    maxChars: opts.maxChars,
    priority: opts.priority,
    orchestrate: orchestrateOpts,
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

  // One writer/counter per server process prevents overlapping request IDs.
  const eventSink = opts.eventsPath ? new FileSink(opts.eventsPath) : new NoopSink();
  const eventRoot = createReporter({ sink: eventSink, writer: "s" });

  // 5. Handle tool calls.
  mcpServer.setRequestHandler(CallToolRequestSchema, async (req, extra) => {
    const start = Date.now();
    const toolDef = framework.tools.find((t) => t.name === req.params.name);
    if (!toolDef) {
      return {
        content: [{ type: "text", text: opts.kind === "branch-only" ? `Unknown tool: ${req.params.name} — use the \`branch\` tool to call it` : `Unknown tool: ${req.params.name}` }],
        isError: true,
        _meta: { "aiw/durationMs": Date.now() - start },
      };
    }

    const meta = req.params._meta as Record<string, unknown> | undefined;
    const reporter = fromMeta(meta, eventRoot);

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
