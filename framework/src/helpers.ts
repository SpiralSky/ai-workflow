// Host-side helpers exposed to branch programs (see prompt/helpers.d.ts).
import { spawn, type ChildProcess } from "node:child_process";
import { readFile as fsRead, writeFile, glob } from "node:fs/promises";
import { readdirSync, realpathSync } from "node:fs";
import { resolve, relative, extname, dirname, sep, isAbsolute } from "node:path";
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

// Shared with the runner: once `finished` is set, helpers refuse to run and in-flight children are killed.
export interface Ctl { finished: boolean; children: Set<ChildProcess> }
export const newCtl = (): Ctl => ({ finished: false, children: new Set() });
const killTree = (p: ChildProcess) => { try { process.kill(-p.pid!, "SIGKILL"); } catch { /* already gone */ } };
export function stopAll(ctl: Ctl) { ctl.finished = true; for (const p of ctl.children) killTree(p); ctl.children.clear(); }

export function makeHelpers(s: Session, limits: Limits, path: string[], signal: { user?: string } = {}, ctl: Ctl = newCtl()) {
  let calls = 0, llmCalls = 0;
  const alive = () => { if (ctl.finished) throw new Error("branch already finished"); };
  const reserve = () => { // count before running, so parallel calls can't slip past the limit
    alive();
    if (++calls > limits.maxCalls) throw new Error(`limit: more than ${limits.maxCalls} helper calls`);
  };
  const step = (label: string) => { if (!ctl.finished) path.push(label); };
  const llmStep = () => {
    alive();
    if (++llmCalls > limits.maxLLM) throw new Error(`limit: more than ${limits.maxLLM} model calls`);
  };
  const inside = (p: string) => {
    const abs = resolve(s.cwd, p);
    const out = (a: string, base: string) => { const rel = relative(base, a); return rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel); };
    const bad = () => new Error(`path outside workspace: ${p}`);
    if (out(abs, s.cwd)) throw bad();
    let real: string | undefined; // follow symlinks: the file itself, else its parent dir
    for (const c of [abs, dirname(abs)]) { try { real = realpathSync(c); break; } catch { /* missing */ } }
    let realCwd: string; try { realCwd = realpathSync(s.cwd); } catch { realCwd = s.cwd; }
    if (real && out(real, realCwd)) throw bad();
    return abs;
  };
  const timed = async <T>(name: string, args: unknown, fn: () => Promise<T>, label?: (r: T) => string): Promise<T> => {
    reserve();
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
    timed("bash", cmd, () => sh(cmd, s.cwd, opts.timeoutMs ?? 60_000, ctl), (r) => `bash:${r.code}`);

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
      alive();
      await writeFile(abs, src.replace(oldStr, () => newStr));
    });

  const writeNewFile = (p: string, content: string) =>
    timed("writeFile", p, async () => {
      const abs = inside(p);
      alive();
      try { await writeFile(abs, content, { flag: "wx" }); } // wx: atomic create-new
      catch (e: any) { throw e?.code === "EEXIST" ? new Error(`writeFile ${p}: exists; use edit`) : e; }
    });

  const runTests = (filter?: string) =>
    timed("runTests", filter, async () => {
      const cmd = testCommand(s.cwd, filter);
      const r = await sh(cmd, s.cwd, 120_000, ctl);
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

  // Dispatch to Claude Code built-in tools by name. Delegates to existing helpers (no double-counting)
  // except WebFetch which goes through timed() directly.
  const tool = async (name: string, input: Record<string, unknown>): Promise<string> => {
    switch (name) {
      case "Bash": {
        const r = await bash(input.command as string, input.timeout != null ? { timeoutMs: input.timeout as number } : {});
        return r.out;
      }
      case "Read": return readFile(input.file_path as string);
      case "Write": { await writeNewFile(input.file_path as string, input.content as string); return "Written."; }
      case "Edit": { await edit(input.file_path as string, input.old_string as string, input.new_string as string); return "Edited."; }
      case "Glob": return JSON.stringify(await findFiles(input.pattern as string));
      case "Grep": {
        const safePath = input.path != null ? inside(input.path as string) : s.cwd;
        const safePattern = (input.pattern as string).replace(/[`$]/g, "");
        const r = await bash(`grep -rn -- ${JSON.stringify(safePattern)} ${JSON.stringify(safePath)}`);
        return r.out;
      }
      case "WebFetch":
        return timed("tool:WebFetch", input.url, async () => {
          const res = await fetch(input.url as string);
          return res.text();
        });
      default:
        throw new Error(`tool "${name}" not supported in branch`);
    }
  };

  return { bash, readFile, readSymbol, findFiles, edit, writeFile: writeNewFile, runTests, check, classify, weakLLM, llm, parallel, returnUser, getHandle, tool, state: s.state };
}

const FILTERABLE_HELPERS = new Set([
  "bash", "readFile", "readSymbol", "findFiles", "edit", "writeFile",
  "runTests", "check", "classify", "weakLLM", "llm", "tool",
]);

// makeFilteredHelpers wraps makeHelpers and stubs out any helper not in `allowed`.
// Stub throws so the secondary LLM sees a clear error ("tool 'X' not in shortlist").
export function makeFilteredHelpers(
  session: Session, limits: Limits, path: string[], signal: { user?: string }, ctl: Ctl,
  allowed: Set<string>,
): ReturnType<typeof makeHelpers> {
  const helpers = makeHelpers(session, limits, path, signal, ctl) as Record<string, unknown>;
  for (const name of FILTERABLE_HELPERS) {
    if (!allowed.has(name)) {
      helpers[name] = (..._args: unknown[]) => { throw new Error(`tool '${name}' not in shortlist`); };
    }
  }
  return helpers as ReturnType<typeof makeHelpers>;
}

// makeChildSession creates a fresh session sharing the parent's cwd but with isolated handles/state.
export function makeChildSession(parent: Session): Session {
  let traceFile: string | undefined;
  if (parent.traceFile) {
    const dir = dirname(parent.traceFile);
    traceFile = `${dir}/${new Date().toISOString().replace(/[:.]/g, "-")}-child-${process.pid}.jsonl`;
  }
  return { cwd: parent.cwd, handles: new Map(), state: {}, traceFile };
}

async function classifyRaw<L extends string>(text: string, labels: Record<L, string>, s: Session): Promise<L> {
  const keys = Object.keys(labels) as L[];
  const prompt =
    `Classify the TEXT into exactly one label. Reply with only the label key, nothing else.\n\nLabels:\n` +
    keys.map((k) => `- ${k}: ${labels[k]}`).join("\n") +
    `\n\nTEXT:\n<<<\n${text.slice(0, 12_000)}\n>>>`;
  let out = "";
  for (let i = 0; i < 2; i++) {
    out = (await complete(s, MODELS.classify, prompt, 20)).trim().replace(/^["'`]|["'`.]$/g, "");
    const hit = keys.find((k) => k === out) ?? keys.find((k) => out.toLowerCase().startsWith(k.toLowerCase()));
    if (hit) return hit;
  }
  throw new Error(`classify: model returned "${out.slice(0, 60)}" — no match in (${keys.join(", ")})`);
}

function withCtx(prompt: string, ctx?: unknown[]) {
  if (!ctx?.length) return prompt;
  const parts = ctx.map((c, i) => `<ctx ${i + 1}>\n${typeof c === "string" ? c : JSON.stringify(c, null, 1)}\n</ctx>`);
  return `${parts.join("\n")}\n\n${prompt}`;
}

function testCommand(cwd: string, filter?: string) {
  const files = readdirSync(cwd);
  if (files.some((f) => /^test_.*\.py$/.test(f))) return `python3 -m unittest${filter ? ` -k '${filter.replace(/'/g, `'\\''`)}'` : ""} 2>&1`;
  if (files.includes("package.json")) return `npm test --silent${filter ? ` -- --test-name-pattern ${JSON.stringify(filter)}` : ""} 2>&1`;
  const custom = process.env.BRANCH_TEST_CMD;
  if (custom) return custom + " 2>&1";
  throw new Error("runTests: no known test setup in workspace (set BRANCH_TEST_CMD to override)");
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
  const start = lines.findIndex((l) => new RegExp(`\\b(function|class|const|let|var|def|fn|interface|type|enum)\\s+${esc}\\b`).test(l));
  if (start < 0) return;
  const from = lines.slice(0, start).reduce((n, l) => n + l.length + 1, 0);
  // scan skipping strings/comments; end at the closing brace, or at `;` if no brace was opened
  let depth = 0, seen = false, end = src.length;
  scan: for (let i = from; i < src.length; i++) {
    const ch = src[i], nx = src[i + 1];
    if (ch === "/" && nx === "/") { while (i < src.length && src[i] !== "\n") i++; i--; continue; }
    if (ch === "/" && nx === "*") { const e = src.indexOf("*/", i + 2); i = e < 0 ? src.length : e + 1; continue; }
    if (ch === "'" || ch === '"' || ch === "`") {
      for (i++; i < src.length && src[i] !== ch; i++) if (src[i] === "\\") i++;
      continue;
    }
    if (ch === "{") { depth++; seen = true; }
    else if (ch === "}") { depth--; if (seen && depth <= 0) { end = i; break scan; } }
    else if (ch === ";" && !seen && depth <= 0) { end = i; break scan; }
  }
  const nl = src.indexOf("\n", end);
  return src.slice(from, nl < 0 ? src.length : nl);
}

const CAP = 200_000;
export function sh(cmd: string, cwd: string, timeoutMs: number, ctl?: Ctl): Promise<{ code: number; out: string }> {
  return new Promise((res) => {
    const p = spawn("bash", ["-c", cmd], { cwd, detached: true }); // own process group so we can kill grandchildren
    ctl?.children.add(p);
    let out = "", dropped = 0, settled = false, timedOut = false;
    let grace: NodeJS.Timeout | undefined;
    const finish = (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer); clearTimeout(grace);
      ctl?.children.delete(p);
      killTree(p); // leftover background children
      const note = (dropped ? `[…truncated ${dropped} chars]\n` : "");
      res({ code, out: note + out + (timedOut ? `\n[timed out after ${timeoutMs}ms]` : "") });
    };
    const timer = setTimeout(() => { timedOut = true; killTree(p); grace = setTimeout(() => finish(-1), 200); }, timeoutMs);
    const add = (d: string) => { out += d; if (out.length > CAP) { dropped += out.length - CAP; out = out.slice(-CAP); } }; // keep the tail
    p.stdout.setEncoding("utf8"); p.stderr.setEncoding("utf8");
    p.stdout.on("data", add);
    p.stderr.on("data", add);
    p.on("close", (code) => finish(timedOut ? -1 : code ?? -1));
    p.on("exit", (code) => { clearTimeout(grace); grace = setTimeout(() => finish(timedOut ? -1 : code ?? -1), 100); }); // pipes held open by grandchildren
    p.on("error", (e) => { out += String(e); finish(-1); });
  });
}
