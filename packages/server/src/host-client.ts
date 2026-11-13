import { randomUUID } from "node:crypto";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ResultSchema, McpError, type Request, type Notification } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { LLMClient, LLMCompletion } from "@aiw/telemetry";
import { LLMError } from "@aiw/llm";

const HostCompletionSchema = ResultSchema.extend({
  response: z.unknown(),
  usage: z.object({ input: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), output: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    cachedRead: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(), cacheWrite: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() }).refine((usage) => (usage.cachedRead ?? 0) <= usage.input),
  costUsd: z.number().finite().nonnegative().optional(),
  cacheHit: z.boolean().optional(),
  costSource: z.enum(["api", "price-table", "api-equivalent"]).optional(),
  priceTable: z.string().max(64).optional(),
});

/** Only nonsecret error classification may cross the inference boundary. */
const HostErrorDataSchema = z.object({ aiwLLMError: z.object({
  kind: z.enum(["infra", "context-limit", "other"]),
  status: z.number().int().min(100).max(599).optional(),
}).strict() }).strict();

/** Creates a credential-free executor using the explicitly opted-in host's stdio broker. */
export function createHostLLMClient(server: () => Server<Request, Notification>, opts: { timeoutMs?: number } = {}): LLMClient {
  const timeoutMs = opts.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("Invalid host LLM timeout");
  return {
    async complete(req): Promise<LLMCompletion> {
      const callerSignal = req.signal instanceof AbortSignal ? req.signal : undefined;
      const timeout = AbortSignal.timeout(timeoutMs);
      const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
      signal.throwIfAborted();
      const endpoint = server();
      if (!endpoint.getClientCapabilities()?.experimental?.["aiw/llm/complete"]) {
        throw new LLMError("infra", "Host LLM broker is not available");
      }
      const requestId = randomUUID();
      const cancel = () => { void endpoint.notification({ method: "aiw/llm/cancel", params: { requestId } }).catch(() => {}); };
      signal?.addEventListener("abort", cancel, { once: true });
      try {
        const result = await endpoint.request({ method: "aiw/llm/complete", params: {
          requestId, system: req.system, messages: req.messages, tools: req.tools,
        } }, HostCompletionSchema, { signal, timeout: timeoutMs });
        return { response: result.response, usage: result.usage, costUsd: result.costUsd, costSource: result.costSource, priceTable: result.priceTable, cacheHit: result.cacheHit };
      } catch (error) {
        cancel();
        if (callerSignal?.aborted) throw new DOMException("Host LLM request cancelled", "AbortError");
        const classified = HostErrorDataSchema.safeParse(error instanceof McpError ? error.data : undefined);
        throw new LLMError(classified.success ? classified.data.aiwLLMError.kind : "infra", "Host LLM request failed",
          classified.success ? classified.data.aiwLLMError.status : undefined);
      } finally { signal?.removeEventListener("abort", cancel); }
    },
  };
}
