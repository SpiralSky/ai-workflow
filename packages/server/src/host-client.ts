import { randomUUID } from "node:crypto";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ResultSchema, type Request, type Notification } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { LLMClient, LLMCompletion } from "@aiw/telemetry";
import { LLMError } from "@aiw/llm";

const HostCompletionSchema = ResultSchema.extend({
  response: z.unknown(),
  usage: z.object({ input: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), output: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
    cachedRead: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional(), cacheWrite: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).optional() }).refine((usage) => (usage.cachedRead ?? 0) <= usage.input),
  costUsd: z.number().finite().nonnegative().optional(),
  cacheHit: z.boolean().optional(),
});

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
        return { response: result.response, usage: result.usage, costUsd: result.costUsd, cacheHit: result.cacheHit };
      } catch (error) {
        cancel();
        if (callerSignal?.aborted) throw error;
        throw new LLMError("infra", "Host LLM request failed");
      } finally { signal?.removeEventListener("abort", cancel); }
    },
  };
}
