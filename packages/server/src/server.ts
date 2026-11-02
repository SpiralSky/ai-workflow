import { createHostClassifierClient } from "./host-classifier.ts";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type Request, type Notification } from "@modelcontextprotocol/sdk/types.js";
import { hotPathCatalogFingerprint, HOT_PATH_PROMPT_KEY, buildFramework, buildRegistry, isolatedVMRuntime, quickJSRuntime, loadPrompt, type Host } from "@aiw/core";
import { canonicalJSON, createReporter, NoopSink, FileSink, fromMeta } from "@aiw/telemetry";
import { createChatClient } from "@aiw/llm";
import { createHostLLMClient } from "./host-client.ts";
import type { FrameworkKind } from "@aiw/core";

/** Parsed variant keys shared with runner/core. */
export type VariantKeys = import("@aiw/core").FrameworkVariantKeys;

/** Options for `startServer`. */
export interface ServerOptions {
  /** Selected isolate runtime; omitted preserves the core QuickJS default. */
  runtime?: import("@aiw/core").IsolateRuntime;
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
  /** Host broker leaves all provider credentials outside the task container. */
  orchestrateProvider?: "openrouter" | "host";
  /** Orchestrate executor: API key. */
  orchestrateApiKey?: string;
  /** Orchestrate executor: base URL (default: https://openrouter.ai/api/v1). */
  orchestrateBaseURL?: string;
  /** Orchestrate executor: workspace root (default: process.cwd()). */
  orchestrateWorkspaceRoot?: string;
  /** Orchestrate executor: per-executor turn cap (default 4). */
  secondaryCap?: number;
  classifierModel?: string;
  classifierThreshold?: number;
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

  let mcpServer: Server<Request, Notification>;
  // 2. Build orchestrate options if needed.
  let orchestrateOpts: import("@aiw/core").OrchestrateOptions | undefined;
  if (opts.kind === "orchestrate") {
    if (!opts.orchestrateModel) throw new Error("orchestrate requires --executor-model");
    if (opts.orchestrateProvider !== "host" && !opts.orchestrateApiKey) throw new Error("orchestrate requires an executor API key (--executor-api-key or OPENROUTER_API_KEY)");
    const client = opts.orchestrateProvider === "host" ? createHostLLMClient(() => mcpServer) : createChatClient({
      baseURL: opts.orchestrateBaseURL ?? "https://openrouter.ai/api/v1",
      apiKey: opts.orchestrateApiKey!,
      timeoutMs: 300_000,
    });
    if (opts.variant?.rerank === "classifier" && (opts.orchestrateProvider !== "host" || !opts.classifierModel || opts.classifierThreshold === undefined)) throw new Error("Classifier requires explicit host model/settings");
    orchestrateOpts = {
      client,
      model: opts.orchestrateModel,
      ...(opts.variant?.rerank === "classifier" ? { classifier: { client: createHostClassifierClient(() => mcpServer), model: opts.classifierModel!, threshold: opts.classifierThreshold!, policy: "noul-v1" as const } } : {}),
      workspaceRoot: opts.orchestrateWorkspaceRoot ?? process.cwd(),
      ...(opts.secondaryCap !== undefined ? { turns: opts.secondaryCap } : {}),
    };
  }

  // 3. Assemble the framework.
  const framework = buildFramework(opts.kind, registry, {
    runtime: opts.runtime,
    host: opts.host,
    variant: opts.variant,
    branchContext: opts.branchContext,
    maxChars: opts.maxChars,
    priority: opts.priority,
    orchestrate: orchestrateOpts,
  });

  // 3. Create MCP Server with instructions set.
  mcpServer = new Server<Request, Notification>(
    { name: "aiw-server", version: "1.0.0" },
    {
      capabilities: { tools: {} },
      instructions: framework.instructions || undefined,
    },
  );

  // Derive this observation from the selected runtime object and executed entrypoint, not CLI strings.
  const actualRuntime = opts.runtime ?? quickJSRuntime;
  const engine = actualRuntime === isolatedVMRuntime ? "isolated-vm" : actualRuntime === quickJSRuntime ? "quickjs" : "custom-unattested";
  const digest = (value: string | Buffer) => createHash("sha256").update(value).digest("hex");
  const prompts = Object.fromEntries(["base", "branch-only", "branch-tool", "do-tool", "executor", "orchestrate", "rerank", "resolve-tool"]
    .map((name) => [name, digest(loadPrompt(name))]));
  prompts[HOT_PATH_PROMPT_KEY] = hotPathCatalogFingerprint();
  const entryHash = process.argv[1] ? digest(readFileSync(process.argv[1])) : null;

  // 4. Advertise framework tools via tools/list.
  mcpServer.setRequestHandler(ListToolsRequestSchema, async () => ({
    _meta: { "aiw/runtimeProvenance": { version: 1, engine, entryHash, prompts, catalogHash: digest(canonicalJSON(hostDecls)), settings: { kind: opts.kind, variant: opts.variant ?? {}, branchContext: opts.branchContext ?? "trace", secondaryCap: opts.secondaryCap ?? 4, secondaryTemperature: orchestrateOpts?.temperature ?? null, ...(orchestrateOpts?.classifier ? { classifier: { model: orchestrateOpts.classifier.model, threshold: orchestrateOpts.classifier.threshold, policy: orchestrateOpts.classifier.policy } } : {}) }, nodeVersion: process.version, runtimePlatform: { platform: process.platform, arch: process.arch, moduleABI: process.versions.modules } } },
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

    // MCP cancellation must reach host, selection and executor work.

    // Throttled progress notification (≤ 2/s).
    const progressToken = meta?.progressToken;
    let lastNotifyMs = 0;
    const THROTTLE_MS = 500;

    const args = (req.params.arguments ?? {}) as Record<string, unknown>;
    const result = await toolDef.handle(args, {
      reporter,
      signal: extra.signal,
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
  // The SDK transport does not close itself on stdin EOF. Release long-lived sidecars explicitly.
  const closeOnEOF = () => { void mcpServer.close(); };
  process.stdin.once("end", closeOnEOF);
  mcpServer.onclose = () => {
    process.stdin.off("end", closeOnEOF);
    void opts.host.close().catch(error => console.error("aiw-server: host close failed", error));
  };
  await mcpServer.connect(transport);
}
