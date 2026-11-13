/** Env var name prefixes that never reach tool processes (system-overview §7). */
const SECRET_PREFIXES = ["OPENAI_", "ANTHROPIC_", "OPENROUTER_", "DEEPSEEK_", "TYPESAFE_", "CHATGPT_"];

/**
 * Copy of an environment with API secrets removed: provider-prefixed variables (including direct DeepSeek/TypeSafe and defensive ChatGPT names) and any
 * names listed (comma-separated) in `AIW_SECRET_NAMES`.
 * @param base - source environment
 */
export function toolEnv(base: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv {
  const extra = new Set((base.AIW_SECRET_NAMES ?? "").split(",").map((s) => s.trim()).filter(Boolean));
  const out: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(base)) {
    if (SECRET_PREFIXES.some((p) => k.startsWith(p)) || extra.has(k)) continue;
    out[k] = v;
  }
  return out;
}
