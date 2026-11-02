import { TYPESAFE_MODEL, TYPESAFE_PRICE_BASIS, LLMError, type DecisionsClient } from "@aiw/llm";
import { accountedReranks, rerankerIdentities } from "./reuse-proof.ts";
import type { Reranker } from "./rerank.ts";

/** Explicit experimental threshold policy; probabilities are not calibrated across models. */
export function validateClassifierPolicy(threshold: number, policy: string): void {
  if (policy !== "noul-v1" || !Number.isFinite(threshold) || threshold <= 0.5 || threshold > 1) {
    throw new Error("classifier requires noul-v1 and threshold in (0.5, 1]");
  }
}

/** Typed relevance probabilities, with no paid fallback. Unknown/uncertain answers keep retrieval order. */
export function classifierReranker(client: DecisionsClient, opts: { model: string; threshold: number; policy: "noul-v1" }): Reranker {
  opts = { ...opts };
  validateClassifierPolicy(opts.threshold, opts.policy);
  const classify = client.classify.bind(client);
  const reranker: Reranker = { async rerank(instruction, candidates, ctx = {}) {
    if (ctx.signal?.aborted) throw new DOMException("Classifier selection cancelled", "AbortError");
    if (!candidates.length) return [];
    if (!ctx.reporter) throw new Error("classifier rerank requires selection telemetry");
    const start = performance.now();
    const result = await classify({ instruction, candidates: candidates.map((d, i) => ({
      id: `c${i}`, name: d.name, whenToUse: d.meta.whenToUse, ...(d.meta.whenNotToUse ? { whenNotToUse: d.meta.whenNotToUse } : {}),
    })), signal: ctx.signal });
    // Record a billed malformed answer too. Missing usage remains absent, never fabricated zero.
    ctx.reporter.turn({ role: "selection", model: opts.model, providerModel: result.providerModel,
      classifierEstimate: result.classifierEstimate, usage: result.usage, costUsd: result.costUsd, latencyMs: Math.round(performance.now() - start) });
    const estimate = result.classifierEstimate;
    const directEstimateValid = opts.model === TYPESAFE_MODEL && result.provider === "TypeSafe" && result.providerModel === TYPESAFE_MODEL &&
      estimate?.basis === TYPESAFE_PRICE_BASIS && Number.isFinite(estimate.estimatedUsd) && estimate.estimatedUsd >= 0 &&
      estimate.inputTokens === result.usage?.input && estimate.outputTokens === result.usage?.output &&
      estimate.estimatedUsd === estimate.inputTokens * 0.042 / 1e6 && result.costUsd === undefined;
    if (result.failure || !result.usage || (result.costUsd === undefined && !directEstimateValid)) {
      ctx.reporter.attach("classifierSelection", { policy: opts.policy, threshold: opts.threshold, fallback: false,
        stopped: true, reason: result.failure ? "provider-failure" : "unknown-accounting" });
      throw new LLMError(result.failure ?? "infra", result.failure ? "Classifier provider request failed" : "Classifier accounting incomplete");
    }
    if (!result.providerModel || (result.providerModel !== opts.model && !result.providerModel.startsWith(`${opts.model}-`))) {
      ctx.reporter.attach("classifierSelection", { policy: opts.policy, threshold: opts.threshold, fallback: false,
        stopped: true, reason: "missing-or-mismatched-model-observation" });
      throw new LLMError("infra", "Classifier model observation missing or mismatched");
    }
    const fallback = (reason: string) => {
      ctx.fallback = true; ctx.fallbackReason = reason;
      ctx.reporter!.attach("classifierSelection", { policy: opts.policy, threshold: opts.threshold, fallback: true, reason });
      return candidates;
    };
    const answers = result.answers as Record<string, { type?: unknown; noul?: unknown }> | null;
    if (!answers || typeof answers !== "object" || Array.isArray(answers) || Object.keys(answers).length !== candidates.length) return fallback("malformed-answer");
    const scored: { index: number; probability: number }[] = [];
    for (let i = 0; i < candidates.length; i++) {
      const answer = answers[`c${i}`];
      if (!answer || answer.type !== "noul" || typeof answer.noul !== "number" || !Number.isFinite(answer.noul) || answer.noul < 0 || answer.noul > 1) return fallback("malformed-answer");
      scored.push({ index: i, probability: answer.noul });
    }
    if (scored.some(a => a.probability > 1 - opts.threshold && a.probability < opts.threshold)) return fallback("uncertain-probability");
    const positive = scored.filter(a => a.probability >= opts.threshold).sort((a,b) => b.probability - a.probability || a.index - b.index);
    if (!positive.length) return fallback("no-confident-positive");
    ctx.reporter.attach("classifierSelection", { policy: opts.policy, threshold: opts.threshold, fallback: false,
      scores: scored.map(a => ({ name: candidates[a.index].name, probability: a.probability })) });
    // Only this trusted boundary can establish completed, nonfallback accounting evidence.
    // Invalid numeric accounting is retained in telemetry but never admitted for reuse.
    const finiteNonnegative = (n: unknown) => typeof n === "number" && Number.isFinite(n) && n >= 0;
    if (!ctx.signal?.aborted && result.provider &&
        Object.values(result.usage).every(finiteNonnegative) &&
        finiteNonnegative(result.usage.input) && finiteNonnegative(result.usage.output) &&
        (finiteNonnegative(result.costUsd) || directEstimateValid)) {
      accountedReranks.set(ctx, JSON.stringify({ kind: "classifier", provider: result.provider,
        model: opts.model, observedModel: result.providerModel, threshold: opts.threshold, policy: opts.policy }));
    }
    return positive.map(a => candidates[a.index]);
  } };
  rerankerIdentities.set(reranker, JSON.stringify({ kind: "classifier", ...opts }));
  return reranker;
}
