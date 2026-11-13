import { isDecisionsModel } from "@aiw/llm";
import { validateClassifierPolicy } from "@aiw/core";
import { parseFrameworkVariant } from "@aiw/core";
import type { RunConfig } from "./types.ts";

/** Resolves an effective framework treatment and its executor launch arguments.
 * @param framework - requested canonical or uncanonicalized variant id
 * @param config - run-wide defaults, overridden by explicit supported variant keys
 */
export function frameworkLaunch(framework: string, config: RunConfig): {
  id: string; needsExecutor: boolean; network: "none"; executorArgs: string[];
} {
  const parsed = parseFrameworkVariant(framework);
  const needsExecutor = parsed.kind === "orchestrate";
  const classifier = parsed.variant.rerank === "classifier" ? config.classifier : undefined;
  if (parsed.variant.rerank === "classifier") {
    const openrouter = classifier?.provider === "openrouter-decisions" && isDecisionsModel(classifier.model) &&
      (config.provider ?? "openrouter") === "openrouter";
    const direct = classifier?.provider === "typesafe" && classifier.model === "jev-1.14.0" && config.provider === "deepseek";
    if (!classifier || (!openrouter && !direct)) throw new Error("Unsupported classifier configuration");
    validateClassifierPolicy(classifier.threshold, classifier.policy);
  }
  return {
    id: parsed.id, needsExecutor, network: "none",
    executorArgs: needsExecutor ? [
      "--executor-model", config.models.secondary,
      "--executor-provider", "host",
      "--secondary-cap", String(parsed.variant.secondary ?? config.secondaryCap),
      ...(classifier ? ["--classifier-model", classifier.model, "--classifier-threshold", String(classifier.threshold)] : []),
    ] : [],
  };
}
