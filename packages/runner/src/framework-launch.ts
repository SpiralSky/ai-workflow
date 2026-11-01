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
  return {
    id: parsed.id, needsExecutor, network: "none",
    executorArgs: needsExecutor ? [
      "--executor-model", config.models.secondary,
      "--executor-provider", "host",
      "--secondary-cap", String(parsed.variant.secondary ?? config.secondaryCap),
    ] : [],
  };
}
