import { randomUUID } from "node:crypto";
import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { ResultSchema, type Request, type Notification } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { LLMError, validateDecisionsRequest, type DecisionsClient } from "@aiw/llm";

const Completion = ResultSchema.extend({
  failure: z.enum(["infra", "context-limit", "other"]).optional(),
  answers: z.record(z.string(), z.object({ type: z.literal("noul"), noul: z.number().finite().min(0).max(1) }).strict()).nullable(),
  usage: z.object({ input: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER), output: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER) }).strict().optional(),
  costUsd: z.number().finite().nonnegative().optional(), costSource: z.enum(["api", "price-table"]).optional(), priceTable: z.string().max(64).optional(), providerModel: z.string().max(256).optional(), provider: z.string().max(256).optional(),
});

/** Credential-free typed classifier transport. Provider, model, endpoint and generation settings never come from the task. */
export function createHostClassifierClient(server: () => Server<Request, Notification>): DecisionsClient {
  return { async classify(req) {
    validateDecisionsRequest(req);
    const signal = AbortSignal.any([AbortSignal.timeout(300_000), ...(req.signal ? [req.signal] : [])]);
    if (signal.aborted) throw new DOMException("Host classifier request cancelled", "AbortError");
    const endpoint = server();
    if (!endpoint.getClientCapabilities()?.experimental?.["aiw/classifier/classify"]) throw new LLMError("infra", "Host classifier is unavailable");
    const requestId = randomUUID();
    const cancel = () => { void endpoint.notification({ method: "aiw/llm/cancel", params: { requestId } }).catch(() => {}); };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      return await endpoint.request({ method: "aiw/classifier/classify", params: {
        requestId, instruction: req.instruction, candidates: req.candidates,
      } }, Completion, { signal, timeout: 300_000 });
    } catch {
      cancel();
      if (req.signal?.aborted) throw new DOMException("Host classifier request cancelled", "AbortError");
      throw new LLMError("infra", "Host classifier request failed");
    } finally { signal.removeEventListener("abort", cancel); }
  } };
}
