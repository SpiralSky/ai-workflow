import { randomUUID } from "node:crypto";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ResultSchema, McpError, type Request, type Notification } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { NativeCompletionSchema, assertNumericCompletion, type LLMClient, type LLMCompletion } from "@aiw/telemetry";
import { LLMError } from "@aiw/llm";

const HostCompletionSchema = ResultSchema.extend({
  response: z.unknown(),
  usageStatus: z.never().optional(), usageReason: z.never().optional(), completionEvidence: z.never().optional(),
  usage: z.object({ input: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), output: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    cachedRead: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(), cacheWrite: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() }).refine((usage) => (usage.cachedRead ?? 0) <= usage.input),
  costUsd: z.number().finite().nonnegative().optional(),
  cacheHit: z.boolean().optional(),
  deepseekEstimate: z.object({ basis: z.literal("deepseek-flash:2026-11-01:off-peak"), estimatedUsd: z.number().finite().nonnegative(), cacheHitTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), cacheMissTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), outputTokens: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict().optional(),
});

/** Only nonsecret error classification may cross the inference boundary. */
const HostErrorDataSchema = z.object({ aiwLLMError: z.object({
  kind: z.enum(["infra", "context-limit", "other"]),
  status: z.number().int().min(100).max(599).optional(),
}).strict() }).strict();

/** Creates a credential-free executor using the explicitly opted-in host's stdio broker. */
export function createHostLLMClient(server: () => Server<Request, Notification>, opts: { timeoutMs?: number; nativeMode?: { model: string } } = {}): LLMClient {
  if (opts.nativeMode && !opts.nativeMode.model) throw new Error("Native model label required");
  const timeoutMs = opts.timeoutMs ?? 300_000;
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 1) throw new Error("Invalid host LLM timeout");
  return {
    async complete(req): Promise<LLMCompletion> {
      if (opts.nativeMode) {
        const supported = new Set(["model", "system", "messages", "tools", "signal"]);
        if (req.model !== opts.nativeMode.model || Reflect.ownKeys(req).some(key => typeof key !== "string" || !supported.has(key))) {
          throw new LLMError("other", "Unsupported native request model or control");
        }
      }
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
          ...(opts.nativeMode ? { nativeMode: true } : {}),
          requestId, system: req.system, messages: req.messages, tools: req.tools,
        } }, z.union([HostCompletionSchema, NativeCompletionSchema]), { signal, timeout: timeoutMs });
        if (opts.nativeMode) return NativeCompletionSchema.parse(result);
        assertNumericCompletion(result);
        return { response: result.response, usage: result.usage, costUsd: result.costUsd, cacheHit: result.cacheHit, ...(result.deepseekEstimate ? { deepseekEstimate: result.deepseekEstimate } : {}) };
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
