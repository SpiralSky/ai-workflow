import { parseFrameworkVariant } from "@aiw/core";
import type { RunConfig } from "./types.ts";

/** Resolves an effective framework treatment and its executor launch arguments.
 * @param framework - requested canonical or uncanonicalized variant id
 * @param config - run-wide defaults, overridden by explicit supported variant keys
 * @param credentials - passed to the server as before; never logged here
 */
export function frameworkLaunch(framework: string, config: RunConfig, credentials: { apiKey: string; baseURL: string }): {
  id: string; needsExecutor: boolean; executorArgs: string[];
} {
  const parsed = parseFrameworkVariant(framework);
  const needsExecutor = parsed.kind === "orchestrate";
  return {
    id: parsed.id, needsExecutor,
    executorArgs: needsExecutor ? [
      "--executor-model", config.models.secondary,
      ...(config.provider === "chatgpt" ? ["--executor-provider", "host"] : [
        "--executor-api-key", credentials.apiKey,
        "--executor-base-url", credentials.baseURL,
      ]),
      "--secondary-cap", String(parsed.variant.secondary ?? config.secondaryCap),
    ] : [],
  };
}
