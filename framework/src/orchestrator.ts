// Secondary LLM agentic loop for BRANCH_MODE=orchestrate.
// Receives a task + shortlisted tool entries, runs a branch-program loop,
// and returns a framed report to the main LLM.
import { readFileSync, statSync, readdirSync } from "node:fs";
import { join, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { complete, MODELS } from "./llm.js";
import { runBranch, defaultLimits } from "./runner.js";
import { makeChildSession } from "./helpers.js";
import { trace } from "./trace.js";
import { buildFilteredDecls, buildCompositePrelude } from "./catalog.js";
import type { Session } from "./helpers.js";
import type { Limits } from "./runner.js";
import type { ToolEntry } from "../catalog/types.js";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const SYSTEM_PROMPT_PATH = join(root, "prompt", "orchestrate-system.md");
const MAX_TURNS = parseInt(process.env.BRANCH_ORCHESTRATE_MAX_TURNS ?? "15");
const ORCHESTRATE_MODEL = process.env.BRANCH_ORCHESTRATE_MODEL ?? MODELS.strong;
const STEP_CAP = 6000; // chars kept per step observation

let _systemPrompt: string | undefined;
function systemPrompt(): string {
  if (_systemPrompt) return _systemPrompt;
  try { _systemPrompt = readFileSync(SYSTEM_PROMPT_PATH, "utf8"); }
  catch { _systemPrompt = "Write one branch program per turn. Call returnUser(report) when done."; }
  return _systemPrompt;
}

// Build the set of helper IDs allowed for this shortlist.
// writeFile only creates brand-new files; using it on existing workspace files always throws.
// patchAndVerify's implementation calls writeFile — excluding it removes a whole class of error loops.
// readAndSummarize calls weakLLM for summarization, which is expensive and rarely helpful vs readFile.
const ORCHESTRATE_EXCLUDED = new Set(["writeFile", "patchAndVerify", "readAndSummarize"]);

// Build the set of helper IDs allowed for this shortlist.
// Always includes the floor set; composites pull in their declared dependencies.
function buildAllowedSet(shortlist: ToolEntry[]): Set<string> {
  const allowed = new Set<string>();
  for (const entry of shortlist) {
    if (ORCHESTRATE_EXCLUDED.has(entry.id)) continue;
    allowed.add(entry.id);
    if (entry.composite?.dependencies) {
      for (const dep of entry.composite.dependencies) {
        if (!ORCHESTRATE_EXCLUDED.has(dep)) allowed.add(dep);
      }
    }
  }
  return allowed;
}

function stripFences(code: string): string {
  return code
    .replace(/^```(?:typescript|ts|js|javascript)?\r?\n?/m, "")
    .replace(/\r?\n?```\s*$/m, "")
    .trim();
}

const SKIP_DIRS = new Set(["node_modules", ".git", "__pycache__", ".branch-tmp", "hidden"]);

import type { Dirent } from "node:fs";

function getFileMtimes(dir: string): Map<string, number> {
  const m = new Map<string, number>();
  const walk = (d: string) => {
    let entries: Dirent<string>[];
    try { entries = readdirSync(d, { withFileTypes: true, encoding: "utf8" }); } catch { return; }
    for (const e of entries) {
      const p = join(d, e.name);
      if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(p); }
      else if (e.isFile()) { try { m.set(p, statSync(p).mtimeMs); } catch {} }
    }
  };
  walk(dir);
  return m;
}

function anyFileChanged(before: Map<string, number>, dir: string): boolean {
  const after = getFileMtimes(dir);
  for (const [p, t] of after) {
    if (!before.has(p) || before.get(p) !== t) return true;
  }
  return false;
}

function listWorkspaceFiles(dir: string): string {
  const files: string[] = [];
  const walk = (d: string, rel: string) => {
    let entries: Dirent<string>[];
    try { entries = readdirSync(d, { withFileTypes: true, encoding: "utf8" }); } catch { return; }
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const relPath = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(join(d, e.name), relPath);
      else if (e.isFile()) files.push(relPath);
    }
  };
  walk(dir, "");
  return files.join("\n");
}

function capStep(text: string, turn: number, kind: string): string {
  const prefix = `[turn ${turn + 1} / ${kind}] `;
  const body = text.slice(0, STEP_CAP);
  const suffix = text.length > STEP_CAP ? `…[truncated ${text.length - STEP_CAP} chars]` : "";
  return prefix + body + suffix;
}

// Injected dependencies — override in tests.
export interface OrchestratorDeps {
  completeFn?: (s: Session, model: string, prompt: string) => Promise<string>;
  runBranchFn?: typeof runBranch;
  // frameFn overrides the final report-framing LLM call; useful in tests to avoid an extra completeFn call.
  frameFn?: (task: string, steps: string[], finalMessage: string | undefined, filesChanged?: boolean) => Promise<string>;
  // disableEditGuard: skip the hallucinated-edit check (for tests with mocked runBranchFn).
  disableEditGuard?: boolean;
}

export async function orchestrate(
  task: string,
  policy: string | undefined,
  shortlist: ToolEntry[],
  parentSession: Session,
  limits: Limits = defaultLimits,
  deps: OrchestratorDeps = {},
): Promise<string> {
  const completeFn = deps.completeFn ?? complete;
  const runBranchFn = deps.runBranchFn ?? runBranch;
  const childSession = makeChildSession(parentSession);

  // Tag child trace so the viewer can associate it with this run.
  const parentTag = parentSession.traceFile ? basename(parentSession.traceFile, ".jsonl") : undefined;
  if (parentTag) trace(childSession, { type: "session", parentTag });

  const doFrame = deps.frameFn
    ? deps.frameFn
    : (t: string, s: string[], f: string | undefined, fc?: boolean) => frameReport(t, s, f, completeFn, childSession, fc);
  // Strip excluded helpers from the shortlist before building decls and allowed set,
  // so they don't appear in the prompt at all.
  const prunedShortlist = shortlist.filter(e => !ORCHESTRATE_EXCLUDED.has(e.id));
  const allowedSet = buildAllowedSet(prunedShortlist);
  const filteredDecls = buildFilteredDecls(prunedShortlist);
  const compositePrelude = buildCompositePrelude(prunedShortlist);

  const toolBlock = `## Available helpers\n\`\`\`ts\n${filteredDecls || "(no helpers selected)"}\n\`\`\``;
  const policyBlock = policy ? `\n\n## Policy\n${policy}` : "";

  // Inject workspace file listing so the secondary LLM knows all files that exist.
  const fileList = listWorkspaceFiles(parentSession.cwd);
  const fileListBlock = fileList ? `\n\n## Workspace files\n\`\`\`\n${fileList}\n\`\`\`` : "";

  // Snapshot mtimes for hallucinated-edit guard.
  const mtimesBefore = getFileMtimes(parentSession.cwd);
  const isReadOnly = policy ? /do not make|don't make|only read|no changes|read.?only|stop after/i.test(policy) : false;

  const steps: string[] = [];

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const priorBlock = steps.length > 0
      ? `\n\n## Prior step results\n${steps.join("\n---\n")}`
      : "";

    const prompt =
      `${systemPrompt()}\n\n${toolBlock}${fileListBlock}\n\n## Task\n${task}${policyBlock}${priorBlock}`;

    let code: string;
    let llmErr: string | undefined;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        code = await completeFn(childSession, ORCHESTRATE_MODEL, prompt);
        llmErr = undefined;
        break;
      } catch (e: any) {
        llmErr = String(e);
        const isTransient = /429|rate.?limit|5\d\d|timeout/i.test(llmErr);
        if (!isTransient || attempt === 2) break;
        await new Promise(r => setTimeout(r, (attempt + 1) * 2_000));
      }
    }
    if (llmErr !== undefined) {
      steps.push(`LLM error on turn ${turn + 1}: ${llmErr}`);
      break;
    }

    code = stripFences(code);
    const looksLikeCode = /\b(const|let|var|await|return|async|function|returnUser)\b/.test(code);
    if (!looksLikeCode) {
      steps.push(`[turn ${turn + 1} / not-code] Output does not look like TypeScript. Write a program (start with variable declarations or await calls), not a description. End with return or returnUser().`);
      continue;
    }
    // Inject a writeFile override that throws a clear message directing to edit().
    // The secondary LLM often generates patchAndVerify helpers that call writeFile(path, content)
    // to replace entire files. That always fails on existing files. This override surfaces a
    // clear "use edit()" instruction in the step results so the secondary can learn.
    const writeFileOverride = `const writeFile = async (path: string, _content?: string): Promise<void> => {\n  throw new Error(\`writeFile is DISABLED in orchestrate mode. Use edit(path, oldStr, newStr) instead. To replace a whole file: const c = await readFile(path); await edit(path, c, newContent);\`);\n};\n`;
    const fullCode = (compositePrelude ? `${compositePrelude}\n` : "") + writeFileOverride + code;

    const result = await runBranchFn(fullCode, childSession, limits, undefined, allowedSet);

    if (result.kind === "user") {
      // Hallucinated-edit guard: if the task expected changes but no file was modified, retry.
      if (!isReadOnly && !deps.disableEditGuard && !anyFileChanged(mtimesBefore, parentSession.cwd)) {
        steps.push(`[turn ${turn + 1} / no-edit-guard] returnUser was called but no files were modified. Apply changes with edit() before calling returnUser. (writeFile only creates brand-new files — it always fails on existing ones.) Describe what you tried.`);
        continue;
      }
      const hasTestEvidence = /ran \d+|tests? pass|\bok\b|FAILED|ERROR:/i.test(result.text ?? "");
      if (!isReadOnly && !deps.disableEditGuard && anyFileChanged(mtimesBefore, parentSession.cwd) && !hasTestEvidence) {
        steps.push(`[turn ${turn + 1} / no-test-guard] returnUser was called but the report contains no test output. Run runTests() and include the result (pass count or failure details) before calling returnUser.`);
        continue;
      }
      // Secondary LLM's returnUser message is already a concise report — skip the extra framing call.
      return result.text || await doFrame(task, steps, undefined);
    }

    steps.push(capStep(result.text, turn, result.kind));
  }

  // Exhausted turns or broke early — frame whatever was collected
  const filesChanged = anyFileChanged(mtimesBefore, parentSession.cwd);
  return doFrame(task, steps, undefined, filesChanged);
}

async function frameReport(
  task: string,
  steps: string[],
  finalMessage: string | undefined,
  completeFn: (s: Session, model: string, prompt: string) => Promise<string>,
  s: Session,
  filesChanged = true,
): Promise<string> {
  const MAX_EVIDENCE = 12_000;
  let evidenceStr = steps.join("\n---\n");
  if (evidenceStr.length > MAX_EVIDENCE) {
    evidenceStr = "…[earlier steps truncated]\n---\n" + evidenceStr.slice(-MAX_EVIDENCE);
  }
  const evidence = finalMessage
    ? `Final result:\n${finalMessage}`
    : steps.length > 0
    ? `Step results:\n${evidenceStr}`
    : "No steps were completed.";

  const noEditNote = !filesChanged
    ? "\n\nCRITICAL: No files were modified during this run. Do NOT describe any fix as having been applied. Report that the task could not be completed."
    : "";

  const prompt =
    `Given the task: "${task}"\n\n${evidence}${noEditNote}\n\n` +
    `Write a concise report (3-8 sentences) summarizing what was accomplished, ` +
    `what was found or changed, and any remaining issues. ` +
    `Include specific file paths and test results where relevant. ` +
    `Do not pad with preamble.`;

  try {
    return await completeFn(s, MODELS.weak, prompt);
  } catch {
    return evidence; // fallback: return raw evidence if framing fails
  }
}
