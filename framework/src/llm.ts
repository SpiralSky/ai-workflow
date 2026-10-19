// Sub-model calls. Uses OPENAI_BASE_URL + OPENAI_API_KEY (OpenAI-compatible; works with OpenRouter).
import type { Session } from "./helpers.js";
import { trace } from "./trace.js";

const DEFAULT_MODEL = "deepseek/deepseek-chat-v3-0324";
export const MODELS = {
  classify: process.env.BRANCH_CLASSIFY_MODEL ?? DEFAULT_MODEL,
  weak: process.env.BRANCH_WEAK_MODEL ?? DEFAULT_MODEL,
  strong: process.env.BRANCH_STRONG_MODEL ?? DEFAULT_MODEL,
};
const SYSTEM = "You are a precise sub-model called from a program. Output only what is asked: no preamble, no markdown fences unless asked.";

const PRICING: Record<string, [number, number]> = {
  "deepseek/deepseek-chat-v3": [0.27, 1.10],
  "deepseek/deepseek-r1":      [0.55, 2.19],
};

function modelCost(model: string, promptTok: number, completionTok: number): number {
  const key = Object.keys(PRICING).find(k => model.startsWith(k));
  if (!key) return 0;
  const [rIn, rOut] = PRICING[key];
  return (rIn * promptTok + rOut * completionTok) / 1_000_000;
}

export async function complete(s: Session, model: string, prompt: string, maxTokens = 4096, traceType = "llm"): Promise<string> {
  const t0 = Date.now();
  const r = await viaApi(model, prompt, maxTokens);
  trace(s, { type: traceType, model, backend: r.backend, ms: Date.now() - t0, promptChars: prompt.length, outChars: r.text.length, usage: r.usage, costUsd: r.cost });
  return r.text;
}

async function viaApi(model: string, prompt: string, maxTokens: number) {
  const baseUrl = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/$/, "");
  const res = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Authorization": `Bearer ${process.env.OPENAI_API_KEY!}`, "content-type": "application/json" },
    signal: AbortSignal.timeout(180_000),
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "system", content: SYSTEM }, { role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`llm api ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j: any = await res.json();
  if (!j.choices?.[0]?.message) throw new Error(`llm api: unexpected response shape: ${JSON.stringify(j).slice(0, 200)}`);
  const u = j.usage ?? {};
  return { backend: "api", text: j.choices[0].message.content ?? "", usage: { prompt_tokens: u.prompt_tokens, completion_tokens: u.completion_tokens }, cost: modelCost(model, u.prompt_tokens ?? 0, u.completion_tokens ?? 0) };
}

