import { runWithReporter } from "./context.ts";
import { ReporterImpl, type Reporter } from "./reporter.ts";
import { NativeCompletionSchema, rejectNativeFormat, type Role, type Usage } from "./schema.ts";
import type { TranscriptWriter } from "./transcript.ts";

type ToolFn = (args: any, ...rest: any[]) => Promise<unknown> | unknown;

function resultBytes(result: unknown): number {
  if (typeof result === "string") return Buffer.byteLength(result);
  const json = JSON.stringify(result);
  return json === undefined ? 0 : Buffer.byteLength(json);
}

/**
 * Wraps tool functions so each call writes `toolStart` then `tool`, and runs with a reporter
 * scoped to the tool's id available via `currentReporter()`. Nested wrapped calls therefore nest
 * under the outer tool. Errors are recorded (`ok: false`) and rethrown unchanged.
 *
 * The scoped reporter uses `scopedTo(id)` and writes no `scope` event: the tool event itself is
 * the parent, and its `scope` is the call id. Extra arguments (e.g. a per-call ctx) are forwarded.
 * The explicit `reporter` always wins over `currentReporter()` (telemetry §2: reporters
 * are passed explicitly); a tool that nests calls reads `currentReporter()` to wrap them.
 * @param tools - name to function map
 * @param reporter - reporter the calls are recorded under
 */
export function wrapTools<T extends Record<string, ToolFn>>(tools: T, reporter: Reporter): T {
  const out: Record<string, ToolFn> = {};
  for (const [name, fn] of Object.entries(tools)) {
    out[name] = async (args: unknown, ...rest: unknown[]) => {
      const base = reporter;
      const id = base.newId();
      base.toolStart({ id, name, args });
      const scoped = base instanceof ReporterImpl ? base.scopedTo(id) : base.child(name, id);
      const startTs = Date.now();
      const t0 = performance.now();
      try {
        const result = await runWithReporter(scoped, () => fn(args, ...rest));
        base.tool({
          id, name, args, ok: true, startTs,
          durationMs: Math.round(performance.now() - t0),
          resultBytes: resultBytes(result),
        });
        return result;
      } catch (e) {
        base.tool({
          id, name, args, ok: false, startTs,
          durationMs: Math.round(performance.now() - t0),
          error: e instanceof Error ? e.message : String(e),
          resultBytes: 0,
        });
        throw e;
      }
    };
  }
  return out as T;
}

/**
 * Builds a reporter for one MCP request: scoped to `aiw/parent` (or root) with `aiw/harnessId`.
 * Derived from the process's root reporter so ids stay unique across requests.
 * @param meta - request `_meta`, may be undefined
 * @param root - the server process's root reporter
 */
export function fromMeta(meta: Record<string, unknown> | undefined, root: ReporterImpl): Reporter {
  const parent = meta?.["aiw/parent"];
  const harnessId = meta?.["aiw/harnessId"];
  return root.scopedTo(
    typeof parent === "string" ? parent : null,
    typeof harnessId === "string" ? harnessId : undefined,
  );
}

export interface NumericLLMCompletion {
  usageStatus?: never;
  usageReason?: never;
  completionEvidence?: never;
  response: unknown;
  usage: Usage;
  deepseekEstimate?: { basis: string; estimatedUsd: number; cacheHitTokens: number; cacheMissTokens: number; outputTokens: number };
  costUsd?: number;
  cacheHit?: boolean;
}

/** Unknown native usage is not numeric provider accounting. */
export type NativeLLMCompletion = import("zod").z.infer<typeof NativeCompletionSchema> & {
  costUsd?: never; cacheHit?: never; deepseekEstimate?: never;
};
export type LLMCompletion = NumericLLMCompletion | NativeLLMCompletion;
/** Narrow before numeric accounting; never cast or manufacture token counts. */
export function assertNumericCompletion(value: LLMCompletion): asserts value is NumericLLMCompletion {
  rejectNativeFormat(value);
}

export interface LLMClient {
  complete(req: {
    model: string;
    system: string;
    tools: unknown[];
    messages: unknown[];
    [k: string]: unknown;
  }): Promise<LLMCompletion>;
}

/** Provider clients retain a statically numeric completion contract. */
export interface NumericLLMClient extends LLMClient {
  complete(req: Parameters<LLMClient["complete"]>[0]): Promise<NumericLLMCompletion>;
}

/**
 * Wraps an LLM client: times each request, writes a `turn` event and, when a transcript writer
 * and session are given, the transcript entry keyed by the turn id. Failed requests write nothing.
 * @param client - client to wrap
 * @param reporter - reporter receiving `turn` events
 * @param role - role recorded on every turn
 * @param opts - optional transcript writer and session name
 */
export function wrapLLM(
  client: LLMClient,
  reporter: Reporter,
  role: Role,
  opts: { transcript?: TranscriptWriter; session?: string } = {},
): LLMClient {
  return {
    async complete(req) {
      const t0 = performance.now();
      const res = await client.complete(req);
      const latencyMs = Math.round(performance.now() - t0);
      const response = res.response as { model?: unknown; system_fingerprint?: unknown } | null;
      const observed = {
        ...(typeof response?.model === "string" && response.model ? { providerModel: response.model } : {}),
        ...(typeof response?.system_fingerprint === "string" && response.system_fingerprint ? { providerSystemFingerprint: response.system_fingerprint } : {}),
      };
      const turnId = res.usageStatus === "unavailable" ? reporter.turn({
        ...NativeCompletionSchema.omit({ response: true }).parse(resWithoutResponse(res)),
        model: req.model, role, latencyMs,
      }) : reporter.turn({
        ...observed,
        model: req.model, role, usage: res.usage, deepseekEstimate: res.deepseekEstimate, costUsd: res.costUsd, cacheHit: res.cacheHit, latencyMs,
      });
      if (opts.transcript && opts.session) {
        opts.transcript.record({
          turnId, session: opts.session, system: req.system, tools: req.tools,
          messages: req.messages, response: res.response,
        });
      }
      return res;
    },
  };
}

/** Remove the response payload before strict native turn metadata validation. */
function resWithoutResponse(res: NativeLLMCompletion) {
  const { response, ...metadata } = res;
  return metadata;
}
