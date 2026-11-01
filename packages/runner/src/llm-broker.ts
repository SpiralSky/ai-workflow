import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { RequestSchema, NotificationSchema, McpError, ErrorCode } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { LLMError } from "@aiw/llm";
import type { LLMClient } from "@aiw/telemetry";

/** Opt-in reverse LLM channel. Credentials and provider settings remain on the host. */
export interface HostLLMBrokerOptions {
  secondaryClient: LLMClient;
  secondaryModel: string;
  signal?: AbortSignal;
  maxRequestBytes?: number;
}

const BrokerRequestSchema = RequestSchema.extend({
  method: z.literal("aiw/llm/complete"),
  params: z.object({
    requestId: z.string().uuid(),
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
  return admission;
}
