import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { RequestSchema, NotificationSchema, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { LLMError, validateDecisionsRequest, type DecisionsClient } from "@aiw/llm";
import { NativeCompletionSchema, assertNumericCompletion, type LLMClient } from "@aiw/telemetry";

/** Opt-in reverse LLM channel. Credentials and provider settings remain on the host. */
export interface HostLLMBrokerOptions {
  nativeMode?: true;
  secondaryClient: LLMClient;
  secondaryModel: string;
  classifierClient?: DecisionsClient;
  signal?: AbortSignal;
  maxRequestBytes?: number;
}

const BrokerRequestSchema = RequestSchema.extend({
  method: z.literal("aiw/llm/complete"),
  params: z.object({
    requestId: z.string().uuid(),
    nativeMode: z.literal(true).optional(),
    system: z.string().max(1_048_576),
    messages: z.array(z.unknown()).max(4096),
    tools: z.array(z.unknown()).max(512),
  }).strict(),
});

/** Session-local inference admission: starts closed and cannot reopen after revocation. */
export interface HostLLMAdmission { open(): void; close(): void; }

/** Installs a CLOSED broker; only persisted runtime attestation may open inference admission. */
export function installHostLLMBroker(client: Client, opts: HostLLMBrokerOptions): HostLLMAdmission {
  const maxBytes = opts.maxRequestBytes ?? 8 * 1024 * 1024;
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 1) throw new Error("invalid broker request limit");
  const active = new Map<string, AbortController>();
  const seen = new Set<string>();
  const session = new AbortController();
  let admitted = false;
  const admission: HostLLMAdmission = {
    open() {
      session.signal.throwIfAborted();
      opts.signal?.throwIfAborted();
      admitted = true;
    },
    close() {
      admitted = false;
      session.abort();
      opts.signal?.removeEventListener("abort", admission.close);
    },
  };
  opts.signal?.addEventListener("abort", admission.close, { once: true });
  if (opts.signal?.aborted) admission.close();
  const onclose = client.onclose;
  client.onclose = () => { admission.close(); onclose?.(); };
  // SDK versions may mishandle numeric MCP request ID 0. This explicit cancellation
  // uses an opaque per-call ID and is independent of the transport request counter.
  client.setNotificationHandler(NotificationSchema.extend({ method: z.literal("aiw/llm/cancel"),
    params: z.object({ requestId: z.string().uuid() }).strict() }), (notification) => {
    active.get(notification.params.requestId)?.abort();
  });
  client.setRequestHandler(BrokerRequestSchema, async (request, extra) => {
    // Reject immediately, never queue startup requests for replay after admission opens.
    if (!admitted || session.signal.aborted || opts.signal?.aborted) {
      throw new McpError(ErrorCode.InvalidRequest, "Host LLM admission is closed");
    }
    if ((request.params.nativeMode === true) !== (opts.nativeMode === true)) {
      throw new McpError(ErrorCode.InvalidParams, "Native completion mode mismatch");
    }
    const requestId = request.params.requestId;
    if (seen.has(requestId) || seen.size >= 10000) {
      throw new McpError(ErrorCode.InvalidParams, "LLM broker request ID reused or session limit reached");
    }
    seen.add(requestId);
    if (Buffer.byteLength(JSON.stringify(request.params)) > maxBytes) {
      throw new McpError(ErrorCode.InvalidParams, "LLM broker request exceeds size limit");
    }
    const controller = new AbortController();
    active.set(requestId, controller);
    const signal = AbortSignal.any([session.signal, controller.signal, extra.signal, ...(opts.signal ? [opts.signal] : [])]);
    try {
      signal.throwIfAborted();
      const completion = await opts.secondaryClient.complete({
        model: opts.secondaryModel,
        system: request.params.system,
        messages: request.params.messages,
        tools: request.params.tools,
        signal,
      });
      signal.throwIfAborted();
      if (opts.nativeMode) return NativeCompletionSchema.parse(completion);
      assertNumericCompletion(completion);
      // No access tokens or connection configuration are returned across this channel.
      return { response: completion.response, usage: completion.usage,
        ...(completion.deepseekEstimate ? { deepseekEstimate: completion.deepseekEstimate } : {}),
        ...(completion.costUsd !== undefined ? { costUsd: completion.costUsd } : {}),
        ...(completion.cacheHit !== undefined ? { cacheHit: completion.cacheHit } : {}) };
    } catch (error) {
      // Provider errors can contain headers or request details. Never reflect them into the sandbox.
      const classified = !signal.aborted && error instanceof LLMError && ["infra", "context-limit", "other"].includes(error.kind)
        ? { aiwLLMError: { kind: error.kind,
            ...(Number.isInteger(error.status) && error.status! >= 100 && error.status! <= 599 ? { status: error.status } : {}) } }
        : undefined;
      throw new McpError(ErrorCode.InternalError, signal.aborted ? "Host LLM request cancelled" : "Host LLM request failed", classified);
    } finally { active.delete(requestId); }
  });
  if (opts.classifierClient) client.setRequestHandler(RequestSchema.extend({
    method: z.literal("aiw/classifier/classify"),
    params: z.object({ requestId: z.string().uuid(), instruction: z.string().max(32768),
      candidates: z.array(z.object({ id: z.string().max(64), name: z.string().max(256),
        whenToUse: z.string().max(8192), whenNotToUse: z.string().max(8192).optional() }).strict()).max(20),
    }).strict(),
  }), async (request, extra) => {
    if (!admitted || session.signal.aborted || opts.signal?.aborted) throw new McpError(ErrorCode.InvalidRequest, "Host classifier admission is closed");
    const { requestId, instruction, candidates } = request.params;
    if (seen.has(requestId) || seen.size >= 10000) throw new McpError(ErrorCode.InvalidParams, "Classifier request ID reused or session limit reached");
    seen.add(requestId);
    try { validateDecisionsRequest({ instruction, candidates }); }
    catch { throw new McpError(ErrorCode.InvalidParams, "Invalid classifier request"); }
    const controller = new AbortController(); active.set(requestId, controller);
    const signal = AbortSignal.any([session.signal, controller.signal, extra.signal, ...(opts.signal ? [opts.signal] : [])]);
    try {
      signal.throwIfAborted();
      const result = await opts.classifierClient!.classify({ instruction, candidates, signal });
      signal.throwIfAborted();
      return { ...(result.classifierEstimate ? { classifierEstimate: result.classifierEstimate } : {}), failure: result.failure, answers: result.answers, usage: result.usage, costUsd: result.costUsd, providerModel: result.providerModel, provider: result.provider };
    } catch {
      throw new McpError(ErrorCode.InternalError, signal.aborted ? "Host classifier request cancelled" : "Host classifier request failed");
    } finally { active.delete(requestId); }
  });
  return admission;
}
