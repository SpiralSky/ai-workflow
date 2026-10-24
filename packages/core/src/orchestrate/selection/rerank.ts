import { wrapLLM, type LLMClient, type Reporter } from "@aiw/telemetry";
import type { ToolDecl } from "../../registry/types.ts";
import { loadPrompt } from "../../framework/prompts.ts";

/** Per-call context for a reranker. */
export interface RerankContext {
  /** Receives the rerank `turn` event (role `selection`); overrides the reranker's own reporter. */
  reporter?: Reporter;
  /** Set by the reranker to true when it could not use the model's answer and kept retrieval order. */
  fallback?: boolean;
}

/** Orders and narrows retrieval candidates by fit for the instruction (orchestrate §7.2). */
export interface Reranker {
  /**
   * @param instruction - the intent text
   * @param candidates - retrieval output, best first
   * @param ctx - reporter and fallback flag
   * @returns an ordered subset of `candidates`, best fit first
   */
  rerank(instruction: string, candidates: ToolDecl[], ctx?: RerankContext): Promise<ToolDecl[]>;
}

/** Keeps retrieval order (the `rerank: none` ablation). */
export const noneReranker: Reranker = {
  async rerank(_instruction, candidates) {
    return candidates;
  },
};

/**
 * Extracts tool names from a model answer: a JSON array (possibly fenced or surrounded by text),
 * else one name per line or comma-separated, with list markers and quotes stripped.
 * @param text - the model's answer
 * @returns names in answer order, or undefined if nothing name-like was found
 */
export function parseNames(text: string): string[] | undefined {
  const arr = /\[[\s\S]*\]/.exec(text);
  if (arr) {
    try {
      const v = JSON.parse(arr[0]);
      if (Array.isArray(v) && v.every((x) => typeof x === "string")) return v;
    } catch {
      // fall through to the list reading
    }
  }
  const names = text
    .split(/[\n,]/)
    .map((s) => s.replace(/^\s*(?:[-*]|\d+[.)])\s*/, "").replace(/^[\s"'`\[]+|[\s"'`\].]+$/g, ""))
    .filter((s) => /^[A-Za-z_$][\w$]*$/.test(s));
  return names.length ? names : undefined;
}

/**
 * Reranker that makes one model call over each candidate's name, `whenToUse` and `whenNotToUse`.
 * The call is reported as a `turn` event with role `selection`. Unknown names and repeats are
 * ignored. If the answer cannot be parsed, or names no known candidate, retrieval order is kept
 * and `ctx.fallback` is set. A failed request throws.
 * @param client - LLM client (telemetry's `LLMClient`)
 * @param opts - `model`; `reporter` for the turn event (a call's `ctx.reporter` takes precedence)
 * @returns the reranker
 */
export function llmReranker(client: LLMClient, opts: { model: string; reporter?: Reporter }): Reranker {
  return {
    async rerank(instruction, candidates, ctx = {}) {
      if (candidates.length === 0) return [];
      const reporter = ctx.reporter ?? opts.reporter;
      if (!reporter) throw new Error("llmReranker needs a reporter (option or ctx) to report the selection turn");
      const list = candidates
        .map((d) => {
          const lines = [`- ${d.name}: ${d.meta.whenToUse}`];
          if (d.meta.whenNotToUse) lines.push(`  Not for: ${d.meta.whenNotToUse}`);
          return lines.join("\n");
        })
        .join("\n");
      const res = await wrapLLM(client, reporter, "selection").complete({
        model: opts.model,
        system: loadPrompt("rerank"),
        tools: [],
        messages: [{ role: "user", content: `Task:\n${instruction}\n\nCandidate tools:\n${list}` }],
      });
      const content = (res.response as { choices?: { message?: { content?: unknown } }[] })?.choices?.[0]?.message?.content;
      const names = typeof content === "string" ? parseNames(content) : undefined;
      const byName = new Map(candidates.map((d) => [d.name, d]));
      const picked = [...new Set(names ?? [])].flatMap((n) => byName.get(n) ?? []);
      if (picked.length === 0) {
        ctx.fallback = true;
        return candidates;
      }
      return picked;
    },
  };
}
