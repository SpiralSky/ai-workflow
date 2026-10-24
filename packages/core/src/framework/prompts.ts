import { readFileSync } from "node:fs";

const cache = new Map<string, string>();

/**
 * Reads a static prompt file from `packages/core/prompts/<name>.md` (cached).
 * @param name - file name without extension
 * @throws Error if the file does not exist
 */
export function loadPrompt(name: string): string {
  let text = cache.get(name);
  if (text === undefined) {
    text = readFileSync(new URL("../../prompts/" + name + ".md", import.meta.url), "utf8");
    cache.set(name, text);
  }
  return text;
}

/** Name of the base system-prompt section used by the runner (framework-runner §5.6). */
export const BASE_PROMPT_NAME = "base";

/** The base prompt text. */
export function basePrompt(): string {
  return loadPrompt(BASE_PROMPT_NAME);
}
