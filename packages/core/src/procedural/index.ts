import { realpath, lstat } from "node:fs/promises";
import { resolve } from "node:path";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { BM25Index } from "../selection/bm25.ts";

/** Typed inputs supported by the deliberately small offline prototype. */
export type InputKind = "identifier" | "string" | "paths";
/** An argument is copied from caller state or from a completed dependency. */
export type Binding = { input: string } | { result: string };
/** A deterministic procedure step; tools and dependencies come from trusted definitions. */
export interface ProcedureStep { id: string; tool: string; dependsOn: string[]; args: Record<string, Binding>; }
/** Trusted executable procedure definition, independent of selector implementation. */
export interface Procedure {
  version: 1; id: string; description: string; category: string;
  inputs: Record<string, InputKind>; steps: ProcedureStep[];
}
/** Structured observations are retained even when a later step fails. `noFit` is set only when a precondition is unmet and nothing was written. */
export interface ToolResult { ok: boolean; reason?: string; noFit?: boolean; [key: string]: unknown; }
/** Caller-supplied host tools retain responsibility for effects and permissions. */
export type ProcedureTool = (workspace: string, args: Record<string, unknown>) => Promise<ToolResult>;
/** Completion is distinct from no-fit, missing input and partial failure. */
export interface ProcedureResult {
  status: "completed" | "does-not-fit" | "needs-input" | "failed";
  reason?: string; observations: Record<string, ToolResult>; completed: string[];
}
/** Optional narrow generative adapter; the prototype has no model implementation. */
export interface ArgumentFiller {
  fill(request: { procedureId: string; missing: Record<string, InputKind>; context: string }): Promise<Record<string, unknown>>;
}

/** Validate typed values; missing fields are reported separately from malformed data. */
function validateInputs(procedure: Procedure, values: Record<string, unknown>): string[] {
  if (Object.keys(values).some(k => !Object.hasOwn(procedure.inputs, k))) throw Error("unknown input");
  const missing: string[] = [];
  for (const [key, kind] of Object.entries(procedure.inputs)) {
    const value = values[key];
    if (value === undefined) { missing.push(key); continue; }
    if (kind === "paths") {
      if (!Array.isArray(value) || !value.length || value.some(x => typeof x !== "string" || !x)) throw Error("invalid paths input");
    } else if (typeof value !== "string" || !value || (kind === "identifier" && !/^[A-Za-z_][A-Za-z0-9_]*$/.test(value))) throw Error("invalid input: " + key);
  }
  return missing;
}

/** Copy known inputs unchanged; ask an optional filler only for genuinely missing fields. */
export async function fillProcedureArguments(procedure: Procedure, known: Record<string, unknown>, context: string, filler?: ArgumentFiller): Promise<Record<string, unknown>> {
  const missing = validateInputs(procedure, known);
  if (!missing.length || !filler) return { ...known };
  const supplied = await filler.fill({ procedureId: procedure.id, missing: Object.fromEntries(missing.map(k => [k, procedure.inputs[k]!])), context });
  if (Object.keys(supplied).some(k => !missing.includes(k))) throw Error("filler changed known or unknown input");
  const merged = { ...known, ...supplied };
  if (validateInputs(procedure, merged).length) throw Error("filler left required inputs missing");
  return merged;
}

/** Execute one trusted acyclic procedure serially, stopping at the first unresolved outcome. */
export async function executeProcedure(procedure: Procedure, workspace: string, inputs: Record<string, unknown>, tools: Record<string, ProcedureTool>): Promise<ProcedureResult> {
  const observations: Record<string, ToolResult> = {}, completed: string[] = [];
  try {
    if (procedure.version !== 1 || !procedure.steps.length || procedure.steps.length > 16) throw Error("invalid procedure");
    const seen = new Set<string>();
    for (const step of procedure.steps) {
      if (!step.id || seen.has(step.id) || !Object.hasOwn(tools, step.tool) || step.dependsOn.some(x => !seen.has(x))) throw Error("invalid step dependency or tool");
      for (const binding of Object.values(step.args)) {
        if ("input" in binding ? !Object.hasOwn(procedure.inputs, binding.input) : !step.dependsOn.includes(binding.result)) throw Error("invalid argument binding");
      }
      seen.add(step.id);
    }
    const missing = validateInputs(procedure, inputs);
    if (missing.length) return { status: "needs-input", reason: missing.join(", "), observations, completed };
    const root = resolve(workspace);
    if ((await lstat(root)).isSymbolicLink() || await realpath(root) !== root) throw Error("workspace must be a canonical directory");
    for (const step of procedure.steps) {
      const args = Object.fromEntries(Object.entries(step.args).map(([k, v]) => [k, "input" in v ? inputs[v.input] : observations[v.result]]));
      const result = await tools[step.tool]!(root, args);
      if (!result || typeof result.ok !== "boolean") throw Error("invalid tool result");
      observations[step.id] = result;
      if (!result.ok) return { status: result.noFit === true ? "does-not-fit" : "failed", reason: result.reason ?? "outcome check failed", observations, completed };
      completed.push(step.id);
    }
    return { status: "completed", observations, completed };
  } catch (error) { return { status: "failed", reason: String(error), observations, completed }; }
}

/** Fixed Python helper invocation: JSON data only, no shell or generated executable source. */
function pythonTool(action: string): ProcedureTool {
  return (workspace, args) => new Promise((resolveResult, reject) => {
    const helper = fileURLToPath(new URL("./python-tools.py", import.meta.url));
    const child = execFile("python3", ["-B", helper, action, workspace], { timeout: 30000, maxBuffer: 1048576 }, (error, stdout) => {
      if (error) { reject(error); return; }
      try { resolveResult(JSON.parse(stdout) as ToolResult); } catch (e) { reject(e); }
    });
    child.stdin!.end(JSON.stringify(args));
  });
}
/** Offline tools implement identifier inspection, token rename and Python unittest checks. */
export const pythonProcedureTools: Record<string, ProcedureTool> = {
  inspect: pythonTool("inspect"), rename: pythonTool("rename"), check: pythonTool("check"),
};

/** Three useful procedures share the same runtime and selectors; none is an autonomous agent. */
export const procedures: Procedure[] = [
  { version: 1, id: "rename-known-symbol", category: "transform", description: "rename known Python symbol identifier while preserving string keys", inputs: { oldName: "identifier", newName: "identifier", paths: "paths", testDirs: "paths" }, steps: [
    { id: "inspect", tool: "inspect", dependsOn: [], args: { symbol: { input: "oldName" }, paths: { input: "paths" } } },
    { id: "rename", tool: "rename", dependsOn: ["inspect"], args: { oldName: { input: "oldName" }, newName: { input: "newName" }, paths: { input: "paths" }, testDirs: { input: "testDirs" }, inspected: { result: "inspect" } } },
    { id: "check", tool: "check", dependsOn: ["rename"], args: { testDirs: { input: "testDirs" } } },
  ] },
  { version: 1, id: "inspect-python-symbol", category: "inspect", description: "locate inspect Python symbol definitions references before refactoring import cycle", inputs: { symbol: "identifier", paths: "paths" }, steps: [
    { id: "inspect", tool: "inspect", dependsOn: [], args: { symbol: { input: "symbol" }, paths: { input: "paths" } } },
  ] },
  { version: 1, id: "check-python-project", category: "validate", description: "run Python unittest regression tests check behavior after change", inputs: { testDirs: "paths" }, steps: [
    { id: "check", tool: "check", dependsOn: [], args: { testDirs: { input: "testDirs" } } },
  ] },
];

/** The classifier selects typed choices, never executable arguments. */
export interface ClassificationRequest { situation: string; choices: { id: string; description: string }[]; }
/** Scores describe selection only; they are not evidence of calibrated probabilities. */
export interface Classifier { classify(request: ClassificationRequest): Promise<{ id: string; score: number }[]>; }
/** Both retrieval and classifier requests are measured in actual serialized UTF-8 bytes. */
export interface SelectionObservation { kind: "classifier-stub" | "retrieval"; inputBytes: number; }
/** Common selector result; choosing several candidates never executes their effects. */
export interface SelectionResult { candidates: string[]; requests: SelectionObservation[]; }
/** All implementations accept identical task context and trusted catalog. */
export interface ProcedureSelector { select(situation: string, catalog: Procedure[]): Promise<SelectionResult>; }

/** Deterministic lexical classifier stub for offline control-flow checks, not model evaluation. */
export const lexicalClassifierStub: Classifier = {
  async classify(request) {
    const ranked = new BM25Index(request.choices.map(x => ({ id: x.id, text: x.description }))).score(request.situation).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
    const top = ranked[0]?.score ?? 1;
    return ranked.map(x => ({ id: x.id, score: x.score / top }));
  },
};

/** Construct flat, hierarchical or BM25 retrieval selectors with interchangeable results. */
export function createProcedureSelector(kind: "flat" | "tree" | "bm25", classifier: Classifier = lexicalClassifierStub, highScore = 0.85): ProcedureSelector {
  if (!Number.isFinite(highScore) || highScore <= 0 || highScore > 1) throw Error("invalid score threshold");
  return { async select(situation, catalog) {
    if (!situation.trim() || new Set(catalog.map(x => x.id)).size !== catalog.length) throw Error("invalid selection input");
    const requests: SelectionObservation[] = [];
    const choose = async (choices: ClassificationRequest["choices"]): Promise<string[]> => {
      const request = { situation, choices };
      requests.push({ kind: "classifier-stub", inputBytes: Buffer.byteLength(JSON.stringify(request)) });
      const ranked = await classifier.classify(request), ids = new Set<string>();
      if (ranked.some(x => !choices.some(c => c.id === x.id) || ids.has(x.id) || !Number.isFinite(x.score) || x.score < 0 || x.score > 1 || !ids.add(x.id))) throw Error("invalid classifier selection");
      ranked.sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      const high = ranked.filter(x => x.score >= highScore);
      return (high.length ? high : ranked.filter(x => x.score > 0).slice(0, 1)).map(x => x.id);
    };
    const descriptors = catalog.map(x => ({ id: x.id, description: x.description }));
    if (kind === "flat") return { candidates: await choose(descriptors), requests };
    if (kind === "bm25") {
      requests.push({ kind: "retrieval", inputBytes: Buffer.byteLength(JSON.stringify({ situation, choices: descriptors })) });
      const ranked = new BM25Index(descriptors.map(x => ({ id: x.id, text: x.description }))).score(situation).sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
      return { candidates: ranked.slice(0, 1).map(x => x.id), requests };
    }
    const categories = [...new Set(catalog.map(x => x.category))].sort();
    const selected = await choose(categories.map(id => ({ id, description: catalog.filter(x => x.category === id).map(x => x.description).join("; ") })));
    const groups = await Promise.all(selected.map(category => choose(catalog.filter(x => x.category === category).map(x => ({ id: x.id, description: x.description })))));
    return { candidates: groups.flat(), requests };
  } };
}
