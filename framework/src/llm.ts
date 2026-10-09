// Sub-model calls. Backend: Anthropic API if ANTHROPIC_API_KEY is set, else the `claude` CLI (subscription auth).
import { spawn } from "node:child_process";
import type { Session } from "./helpers.js";
import { trace } from "./trace.js";

export const MODELS = {
  classify: process.env.BRANCH_CLASSIFY_MODEL ?? "haiku",
  weak: process.env.BRANCH_WEAK_MODEL ?? "haiku",
  strong: process.env.BRANCH_STRONG_MODEL ?? "sonnet",
};
const API_IDS: Record<string, string> = { haiku: "claude-haiku-4-5-20251001", sonnet: "claude-sonnet-5-5", opus: "claude-opus-5-5" };
const SYSTEM = "You are a precise sub-model called from a program. Output only what is asked: no preamble, no markdown fences unless asked.";

export async function complete(s: Session, model: string, prompt: string, maxTokens = 4096, traceType = "llm"): Promise<string> {
  const t0 = Date.now();
  const r = process.env.ANTHROPIC_API_KEY ? await viaApi(model, prompt, maxTokens) : await viaCli(model, prompt);
  trace(s, { type: traceType, model, backend: r.backend, ms: Date.now() - t0, promptChars: prompt.length, outChars: r.text.length, usage: r.usage, costUsd: r.cost });
  return r.text;
}

async function viaApi(model: string, prompt: string, maxTokens: number) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: { "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01", "content-type": "application/json" },
    body: JSON.stringify({ model: API_IDS[model] ?? model, max_tokens: maxTokens, system: SYSTEM, messages: [{ role: "user", content: prompt }] }),
  });
  if (!res.ok) throw new Error(`llm api ${res.status}: ${(await res.text()).slice(0, 300)}`);
  const j: any = await res.json();
  return { backend: "api", text: j.content.map((c: any) => c.text ?? "").join(""), usage: j.usage, cost: undefined };
}

function viaCli(model: string, prompt: string): Promise<{ backend: string; text: string; usage: unknown; cost: number | undefined }> {
  const env = { ...process.env };
  delete env.CLAUDE_CONFIG_DIR; // use the normal login, not the experiment's config (no hooks/MCP there)
  const args = ["-p", "--model", model, "--system-prompt", SYSTEM, "--tools", "", "--strict-mcp-config",
    "--setting-sources", "", "--no-session-persistence", "--output-format", "json"];
  return new Promise((res, rej) => {
    const p = spawn(process.env.CLAUDE_BIN ?? "claude", args, { env, cwd: "/tmp", timeout: 180_000 });
    let out = "", err = "";
    p.stdout.on("data", (d) => (out += d));
    p.stderr.on("data", (d) => (err += d));
    p.on("error", rej);
    p.on("close", (code) => {
      try {
        const j = JSON.parse(out);
        if (j.is_error) return rej(new Error(`llm cli: ${String(j.result).slice(0, 300)}`));
        res({ backend: "cli", text: j.result, usage: j.usage, cost: j.total_cost_usd });
      } catch {
        rej(new Error(`llm cli exit ${code}: ${(err || out).slice(0, 300)}`));
      }
    });
    p.stdin.end(prompt);
  });
}
