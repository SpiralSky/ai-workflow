// Host-side helpers exposed to branch programs (see prompt/helpers.d.ts).
import { spawn } from "node:child_process";
import { readFile as fsRead, writeFile, glob } from "node:fs/promises";
import { existsSync, readdirSync } from "node:fs";
import { resolve, relative, extname } from "node:path";
import { complete, MODELS } from "./llm.js";
import { trace } from "./trace.js";
import type { Limits } from "./runner.js";

export interface Session {
  cwd: string;
  handles: Map<string, string>;
  state: Record<string, unknown>;
  traceFile?: string;
  lastTests?: boolean; // last runTests result this turn (reset after returnUser)
}

export class ReturnUserSignal extends Error { name = "ReturnUserSignal"; }

export function makeHelpers(s: Session, limits: Limits, path: string[], signal: { user?: string } = {}) {
  let calls = 0, llmCalls = 0;
  const step = (label: string) => {
    if (++calls > limits.maxCalls) throw new Error(`limit: more than ${limits.maxCalls} helper calls`);
    path.push(label);
  };
  const llmStep = () => {
    if (++llmCalls > limits.maxLLM) throw new Error(`limit: more than ${limits.maxLLM} model calls`);
  };
  const inside = (p: string) => {
    const abs = resolve(s.cwd, p);
    if (relative(s.cwd, abs).startsWith("..")) throw new Error(`path outside workspace: ${p}`);
    return abs;
  };
  const timed = async <T>(name: string, args: unknown, fn: () => Promise<T>, label?: (r: T) => string): Promise<T> => {
    const t0 = Date.now();
    try {
      const r = await fn();
      step(label ? label(r) : name);
      trace(s, { type: "call", name, args, ms: Date.now() - t0, result: r });
      return r;
    } catch (e: any) {
      step(`${name}:error`);
      trace(s, { type: "call", name, args, ms: Date.now() - t0, error: String(e?.message ?? e) });
      throw e;
    }
  };

  const bash = (cmd: string, opts: { timeoutMs?: number } = {}) =>
    timed("bash", cmd, () => sh(cmd, s.cwd, opts.timeoutMs ?? 60_000), (r) => `bash:${r.code}`);

  const readFile = (p: string) => timed("readFile", p, () => fsRead(inside(p), "utf8"));

  const readSymbol = (p: string, name: string) =>
    timed("readSymbol", { p, name }, async () => {
      const src = await fsRead(inside(p), "utf8");
      const out = extractSymbol(src, name, extname(p));
      if (out === undefined) throw new Error(`symbol ${name} not found in ${p}`);
      return out;
    });

  const findFiles = (pattern: string) =>
    timed("findFiles", pattern, async () => {
      const out: string[] = [];
      for await (const f of glob(pattern, { cwd: s.cwd, exclude: (f: string) => /(^|\/)(node_modules|\.git|__pycache__)(\/|$)/.test(f) }))
        out.push(f);
      return out.sort();
    });

  const edit = (p: string, oldStr: string, newStr: string) =>
    timed("edit", { p, oldStr, newStr }, async () => {
      const abs = inside(p);
      const src = await fsRead(abs, "utf8");
      const n = src.split(oldStr).length - 1;
      if (n !== 1) throw new Error(`edit ${p}: oldStr found ${n} times (need exactly 1)`);
      await writeFile(abs, src.replace(oldStr, () => newStr));
    });

  const writeNewFile = (p: string, content: string) =>
    timed("writeFile", p, async () => {
      const abs = inside(p);
      if (existsSync(abs)) throw new Error(`writeFile ${p}: exists; use edit`);
      await writeFile(abs, content);
    });

  const runTests = (filter?: string) =>
    timed("runTests", filter, async () => {
      const cmd = testCommand(s.cwd, filter);
      const r = await sh(cmd, s.cwd, 120_000);
      s.lastTests = r.code === 0;
      return { ok: r.code === 0, failures: r.code === 0 ? "" : r.out.slice(-2000) };
    }, (r) => `runTests:${r.ok ? "ok" : "fail"}`);

  const check = (text: string, question: string) =>
    timed("check", { question }, async () => {
      llmStep();
      const label = await classifyRaw(text, { yes: `Yes: ${question}`, no: `No: ${question}` }, s);
      return label === "yes";
    }, (r) => `check:${r}`);

  const classify = <L extends string>(text: string, labels: Record<L, string>) =>
    timed("classify", { labels }, async () => { llmStep(); return classifyRaw(text, labels, s); }, (r) => `classify:${r}`);

  const weakLLM = (prompt: string, opts: { ctx?: unknown[] } = {}) =>
    timed("weakLLM", { prompt }, async () => { llmStep(); return complete(s, MODELS.weak, withCtx(prompt, opts.ctx)); });

  // Router stub: always a fresh sub-call for now (Phase 4 adds cost/risk routing).
  const llm = (prompt: string, opts: { ctx?: unknown[] } = {}) =>
    timed("llm", { prompt }, async () => { llmStep(); return complete(s, MODELS.strong, withCtx(prompt, opts.ctx)); }, () => "llm(sub)");

  const parallel = (...ps: Promise<unknown>[]) => Promise.all(ps);

  const returnUser = (message: string): never => {
    path.push("returnUser");
    signal.user = String(message); // survives a try/catch in the program
    throw new ReturnUserSignal(String(message));
  };

  const getHandle = (id: string) => {
    const v = s.handles.get(id);
    if (v === undefined) throw new Error(`no handle ${id}`);
    return v;
  };

  return { bash, readFile, readSymbol, findFiles, edit, writeFile: writeNewFile, runTests, check, classify, weakLLM, llm, parallel, returnUser, getHandle, state: s.state };
}

async function classifyRaw<L extends string>(text: string, labels: Record<L, string>, s: Session): Promise<L> {
  const keys = Object.keys(labels) as L[];
  const prompt =
    `Classify the TEXT into exactly one label. Reply with only the label key, nothing else.\n\nLabels:\n` +
    keys.map((k) => `- ${k}: ${labels[k]}`).join("\n") +
    `\n\nTEXT:\n<<<\n${text.slice(0, 12_000)}\n>>>`;
  for (let i = 0; i < 2; i++) {
    const out = (await complete(s, MODELS.classify, prompt, 20)).trim().replace(/^["'`]|["'`.]$/g, "");
    const hit = keys.find((k) => k === out) ?? keys.find((k) => out.toLowerCase().startsWith(k.toLowerCase()));
    if (hit) return hit;
  }
  throw new Error(`classify: no valid label from model (labels: ${keys.join(", ")})`);
}

function withCtx(prompt: string, ctx?: unknown[]) {
  if (!ctx?.length) return prompt;
  const parts = ctx.map((c, i) => `<ctx ${i + 1}>\n${typeof c === "string" ? c : JSON.stringify(c, null, 1)}\n</ctx>`);
  return `${parts.join("\n")}\n\n${prompt}`;
}

function testCommand(cwd: string, filter?: string) {
  const files = readdirSync(cwd);
  if (files.some((f) => /^test_.*\.py$/.test(f))) return `python3 -m unittest${filter ? ` -k ${JSON.stringify(filter)}` : ""} 2>&1`;
  if (files.includes("package.json")) return `npm test --silent 2>&1`;
  throw new Error("runTests: no known test setup in workspace");
}

export function extractSymbol(src: string, name: string, ext: string): string | undefined {
  const lines = src.split("\n");
  const esc = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (ext === ".py") {
    const start = lines.findIndex((l) => new RegExp(`^\\s*(async\\s+)?(def|class)\\s+${esc}\\b`).test(l));
    if (start < 0) return;
    const indent = lines[start].match(/^\s*/)![0].length;
    let end = start + 1;
    while (end < lines.length && (lines[end].trim() === "" || lines[end].match(/^\s*/)![0].length > indent)) end++;
    while (end > start + 1 && lines[end - 1].trim() === "") end--;
    return lines.slice(start, end).join("\n");
  }
  const start = lines.findIndex((l) => new RegExp(`\\b(function|class|const|let|var|def|fn)\\s+${esc}\\b`).test(l));
  if (start < 0) return;
  let depth = 0, seen = false;
  for (let i = start; i < lines.length; i++) {
    for (const ch of lines[i]) {
      if (ch === "{") { depth++; seen = true; }
      else if (ch === "}") depth--;
    }
    if (seen && depth <= 0) return lines.slice(start, i + 1).join("\n");
  }
  return lines.slice(start).join("\n");
}

export function sh(cmd: string, cwd: string, timeoutMs: number): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    const p = spawn("bash", ["-c", cmd], { cwd, timeout: timeoutMs });
    let out = "";
    const add = (d: Buffer) => { if (out.length < 200_000) out += d.toString(); };
    p.stdout.on("data", add);
    p.stderr.on("data", add);
    p.on("close", (code) => res({ code: code ?? -1, out }));
    p.on("error", (e) => res({ code: -1, out: String(e) }));
  });
}
