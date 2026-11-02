/** Observed run inputs; no model calls or guessed immutable model identities. */
import { createHash } from "node:crypto";
import { execFile, execFileSync } from "node:child_process";
import { promisify } from "node:util";
import { readFileSync, readdirSync, lstatSync, openSync, closeSync, fstatSync, readSync, constants, realpathSync } from "node:fs";
import { join, resolve } from "node:path";
import { parseFrameworkVariant, DEFAULT_TRACE_LIMITS } from "@aiw/core";
import { canonicalJSON } from "@aiw/telemetry";
import { assertProblemBuildContext } from "./build-context.ts";
import { gitProvenance } from "./config.ts";
import type { MCPSession } from "./mcp.ts";
import type { Provenance, RunConfig } from "./types.ts";

export const hashText = (text: string | Buffer): string => createHash("sha256").update(text).digest("hex");
const HASH = /^[a-f0-9]{64}$/;
const IMAGE = /^sha256:[a-f0-9]{64}$/;
/** Hash sorted paths and bytes with explicit boundaries; refuse links/special files. */
export function hashTree(root: string, exclude: (relativePath: string) => boolean = () => false): string {
  const hash = createHash("sha256");
  function visit(path: string, rel: string): void {
    if (rel && exclude(rel)) return;
    const stat = lstatSync(path);
    if (stat.isSymbolicLink()) throw new Error(`provenance cannot attest a symbolic link: ${rel}`);
    if (stat.isDirectory()) {
      hash.update(`directory:${Buffer.byteLength(rel)}:${rel}\0`);
      for (const name of readdirSync(path).sort()) visit(join(path, name), rel ? `${rel}/${name}` : name);
    } else if (stat.isFile()) {
      const bytes = readFileSync(path);
      hash.update(`file:${Buffer.byteLength(rel)}:${rel}:${bytes.length}:`).update(bytes);
    } else throw new Error(`provenance cannot attest special file: ${rel}`);
  }
  visit(root, "");
  return hash.digest("hex");
}
/** Require an owned real directory; neither it nor its ancestors may redirect through links. */
export function requireRealDirectory(path: string): string {
  const full = resolve(path);
  if (!lstatSync(full).isDirectory() || realpathSync(full) !== full) throw new Error("fixture directory must be real and not traverse symbolic links");
  return full;
}
/** Resolve one simple fixture/codebase identifier before any read, mutation or process operation. */
export function problemDirectory(root: string, id: string): string {
  if (typeof id !== "string" || !/^[A-Za-z0-9_][A-Za-z0-9_.-]{0,127}$/.test(id)) throw new Error("unsafe fixture identifier");
  try { return requireRealDirectory(join(requireRealDirectory(root), id)); }
  catch (cause) { throw new Error(`fixture directory unavailable or unsafe for identifier ${id}`, { cause }); }
}
/** Hash declared tracked runtime inputs; never scan credential stores or arbitrary untracked files. */
export function sourceHash(root: string): string {
  const declared = (path: string) => /^(package(?:-lock)?\.json|packages\/(core|llm|runner|server|telemetry|tools)\/(src\/|prompts\/|python\/|fixtures\/|package\.json$|build\.mjs$))/.test(path)
    && !path.split("/").some((part) => ["node_modules", "dist", ".venv", "__pycache__"].includes(part)) && !path.endsWith(".pyc");
  const gitFiles = (args: string[]) => execFileSync("git", ["ls-files", "-z", ...args], { cwd: root, encoding: "utf8" }).split("\0").filter(Boolean);
  if (gitFiles(["--others", "--exclude-standard"]).some(declared)) throw new Error("untracked runtime source must be committed or staged before provenance capture");
  const paths = gitFiles(["--cached"]).filter(declared).sort();
  if (!paths.includes("package.json") || !paths.includes("package-lock.json")) throw new Error("tracked package manifests are required for provenance");
  const records = paths.map((path) => {
    if (/(?:^|\/)(?:\.env(?:\..*)?|[^/]*\.(?:pem|key)|credentials?(?:\.[^/]*)?)$/i.test(path)) throw new Error("credential-like files are not permitted as runtime provenance inputs");
    const full = join(root, path), stat = lstatSync(full);
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`runtime source must be a regular tracked file: ${path}`);
    return { path, executable: stat.mode & 0o111, hash: hashText(readFileSync(full)) };
  });
  return hashText(canonicalJSON(records));
}
/** Hash every mounted bundle byte, including its runtime dependencies. */
export function bundleHash(root: string): string { return hashTree(join(root, "packages/server/dist")); }
/** Exact task-folder hash; reference answers and generated bookkeeping are excluded by spec. */
export function problemHash(dir: string): string {
  return hashTree(dir, (p) => p === "reference" || p === ".selfcheck.json" || p === ".dockerignore" || p.split("/").includes("__pycache__") || p.endsWith(".pyc"));
}
/** Inputs to validation, distinct from source provenance and its reference-excluding task hash. */
export function selfcheckInputHash(problemDir: string): string {
  requireRealDirectory(problemDir);
  assertProblemBuildContext(problemDir);
  for (const name of ["workspace", "checks", "reference"]) {
    if (!lstatSync(join(problemDir, name)).isDirectory()) throw new Error(`self-check requires ${name} directory`);
  }
  for (const name of ["task.md", "task.json", "Dockerfile", "checks/check.sh", "reference/solution.patch", "reference/notes.md"]) {
    if (!lstatSync(join(problemDir, name)).isFile()) throw new Error(`self-check requires ${name} regular file`);
  }
  const task = JSON.parse(readFileSync(join(problemDir, "task.json"), "utf8"));
  const codebase = task.size === "large"
    ? hashTree(problemDirectory(join(problemDir, "..", "_codebases"), task.codebase))
    : null;
  return hashText(canonicalJSON({ taskHash: problemHash(problemDir), reference: hashTree(join(problemDir, "reference")), codebase }));
}
/** Bounded no-follow regular-file reader. Errors never echo untrusted stamp contents. */
function readSelfcheckStamp(path: string): unknown {
  const maxBytes = 4096;
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxBytes) throw new Error("invalid stamp file");
    const buffer = Buffer.alloc(maxBytes + 1);
    let size = 0;
    while (size < buffer.length) {
      const count = readSync(fd, buffer, size, buffer.length - size, null);
      if (count === 0) break;
      size += count;
    }
    if (size > maxBytes) throw new Error("oversized stamp");
    const raw = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
    const value: unknown = JSON.parse(raw);
    // JSON.parse silently accepts repeated object keys. Scan valid JSON tokens before accepting it.
    const seen = new Set<string>();
    let depth = 0;
    for (const token of raw.matchAll(/"(?:\\.|[^"\\])*"|[{}\[\]]/g)) {
      if (token[0] === "{" || token[0] === "[") depth++;
      else if (token[0] === "}" || token[0] === "]") depth--;
      else if (depth === 1 && /^\s*:/.test(raw.slice(token.index! + token[0].length))) {
        const key = JSON.parse(token[0]) as string;
        if (seen.has(key)) throw new Error("duplicate stamp field");
        seen.add(key);
      }
    }
    return value;
  } finally { closeSync(fd); }
}
/** Reject absent, malformed, failed or stale checks; legacy producer hashes are not interchangeable. */
export function assertProblemSelfcheck(problemDir: string): string {
  requireRealDirectory(problemDir);
  assertProblemBuildContext(problemDir);
  const fail = (detail: string): never => { throw new Error(`self-check admission failed for ${problemDir}: ${detail}; run aiw problems check`); };
  let stamp: unknown;
  try {
    stamp = readSelfcheckStamp(join(problemDir, ".selfcheck.json"));
  } catch { fail("missing or malformed stamp"); }
  if (!stamp || typeof stamp !== "object" || Array.isArray(stamp)) fail("malformed stamp");
  const record = stamp as Record<string, unknown>;
  if (Object.keys(record).sort().join(",") !== "checkDurationMs,checkedAt,inputHash,pass,taskHash,version" || record.version !== 1 || record.pass !== true || typeof record.taskHash !== "string" || !HASH.test(record.taskHash) ||
      typeof record.inputHash !== "string" || !HASH.test(record.inputHash) || typeof record.checkedAt !== "string" ||
      !Number.isFinite(Date.parse(record.checkedAt)) || new Date(record.checkedAt).toISOString() !== record.checkedAt || typeof record.checkDurationMs !== "number" ||
      !Number.isFinite(record.checkDurationMs) || record.checkDurationMs < 0) fail("unrecognized or unsuccessful stamp");
  const taskHash = problemHash(problemDir);
  if (record.taskHash !== taskHash || record.inputHash !== selfcheckInputHash(problemDir)) fail("stale inputs changed since validation");
  return taskHash;
}
/** Require the packaged portable artifact to match source before any evaluation may start. */
export function checkBundleFreshness(root: string): void {
  execFileSync(process.execPath, [join(root, "packages/server/build.mjs"), "--check"], { cwd: root, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 });
}
/** Add static fingerprints and explicitly pending runtime observations. Freshness seam is for deterministic fixtures. */
export function collectStaticProvenance(root: string, config: RunConfig, base: Omit<Provenance, "frameworks" | "images" | "problems">,
  freshness: (root: string) => void = checkBundleFreshness): Provenance {
  if (!/^[a-f0-9]{40,64}$/.test(base.commit)) throw new Error("git commit identity is unavailable");
  if (config.branch.timeoutMs !== 120_000 || canonicalJSON(config.branch.limits) !== canonicalJSON(DEFAULT_TRACE_LIMITS)) throw new Error("nondefault branch limits are not yet implemented by the server; refusing misleading provenance");
  // Admit every fixture before bundle subprocesses, provider discovery or job work.
  for (const id of config.problems) assertProblemSelfcheck(problemDirectory(join(root, "experiments/problems"), id));
  freshness(root);
  const promptDir = join(root, "packages/server/dist/prompts");
  const promptHashes = Object.fromEntries(readdirSync(promptDir).filter((name) => name.endsWith(".md")).sort()
    .map((name) => [name.slice(0, -3), hashText(readFileSync(join(promptDir, name)))]));
  if (promptHashes.base !== base.basePrompt) throw new Error("host and bundled base prompts differ");
  const problems: Provenance["problems"] = Object.create(null);
  for (const id of config.problems) {
    const dir = problemDirectory(join(root, "experiments/problems"), id);
    const task = JSON.parse(readFileSync(join(dir, "task.json"), "utf8"));
    if (!Number.isSafeInteger(task.turnLimit) || task.turnLimit < 1) throw new Error(`missing/invalid turnLimit: ${id}`);
    readFileSync(join(dir, "task.md"));
    if (!lstatSync(join(dir, "workspace")).isDirectory() || !lstatSync(join(dir, "checks")).isDirectory()) throw new Error(`missing workspace/checks: ${id}`);
    problems[id] = { taskHash: problemHash(dir), turnLimit: task.turnLimit, wallClockMs: task.turnLimit * 180_000 };
  }
  return { ...base, engine: "pending", frameworks: Object.create(null), images: Object.create(null), problems,
    integrity: { version: 1, sourceHash: sourceHash(root), bundleHash: bundleHash(root), entryHash: hashText(readFileSync(join(root, "packages/server/dist/aiw-server.mjs"))), promptHashes, configHash: hashText(canonicalJSON(config)),
      runtime: "pending", wallClockEnforced: false } };
}
/** Refuse drift between static preflight and a job's first model request. */
export function verifyStaticProvenance(root: string, config: RunConfig, provenance: Provenance, problem: string): void {
  assertProblemSelfcheck(problemDirectory(join(root, "experiments/problems"), problem));
  const currentGit = gitProvenance(root);
  if (currentGit.commit !== provenance.commit || currentGit.dirty !== provenance.dirty) throw new Error("git state changed after provenance preflight");
  const integrity = provenance.integrity;
  if (!integrity || integrity.version !== 1) throw new Error("run lacks static provenance preflight");
  if (integrity.configHash !== hashText(canonicalJSON(config)) || integrity.sourceHash !== sourceHash(root) || integrity.bundleHash !== bundleHash(root)) throw new Error("source, configuration or mounted bundle changed after provenance preflight");
  if (provenance.problems[problem]?.taskHash !== problemHash(problemDirectory(join(root, "experiments/problems"), problem))) throw new Error("problem changed after provenance preflight");
}
/** Read the immutable image ID actually used by this container, never a mutable tag. */
export async function inspectContainerImage(containerId: string): Promise<string> {
  const { stdout } = await promisify(execFile)("docker", ["inspect", "--format", "{{.Image}}", containerId]);
  const image = stdout.trim();
  if (!IMAGE.test(image)) throw new Error("container did not report an immutable image ID");
  return image;
}
/** Record observed framework/image identity before a model request; inconsistent repetitions fail closed. */
export function attestJob(provenance: Provenance, config: RunConfig, problem: string, framework: string, image: string, session: MCPSession): void {
  if (!provenance.integrity || !config.problems.includes(problem) || !config.frameworks.includes(framework)) throw new Error("job has no static provenance selection");
  if (!IMAGE.test(image)) throw new Error("job image must be an immutable sha256 ID");
  const runtime = session.runtimeProvenance;
  if (!runtime || runtime.version !== 1 || runtime.engine !== "isolated-vm" || runtime.entryHash !== provenance.integrity.entryHash || !runtime.prompts || !Object.keys(runtime.prompts).length) throw new Error("server runtime provenance missing or unexpected engine");
  if (canonicalJSON(runtime.prompts) !== canonicalJSON(provenance.integrity.promptHashes)) throw new Error("server prompt fingerprints differ from mounted bundle");
  for (const name of ["base", "branch-only", "branch-tool", "do-tool", "executor", "orchestrate", "rerank", "resolve-tool"]) {
    if (!HASH.test(runtime.prompts[name] ?? "")) throw new Error(`missing server prompt fingerprint: ${name}`);
  }
  if (!runtime.nodeVersion || !/^v\d+\.\d+\.\d+/.test(runtime.nodeVersion)) throw new Error("server runtime version unreported");
  for (const value of Object.values(runtime.prompts)) if (typeof value !== "string" || !HASH.test(value)) throw new Error("invalid server prompt fingerprint");
  if (!runtime.runtimePlatform?.platform || !runtime.runtimePlatform.arch || !runtime.runtimePlatform.moduleABI) throw new Error("server platform/ABI unreported");
  const parsed = parseFrameworkVariant(framework);
  if (!HASH.test(runtime.catalogHash) || !runtime.settings || runtime.settings.kind !== parsed.kind ||
      canonicalJSON(runtime.settings.variant) !== canonicalJSON(parsed.variant) || runtime.settings.branchContext !== config.branch.context ||
      (parsed.kind === "orchestrate" && runtime.settings.secondaryCap !== (parsed.variant.secondary ?? config.secondaryCap))) throw new Error("server treatment/settings differ from configured job");
  const expectedClassifier = parsed.variant.rerank === "classifier" && config.classifier
    ? { model: config.classifier.model, threshold: config.classifier.threshold, policy: config.classifier.policy } : undefined;
  if (canonicalJSON(runtime.settings.classifier ?? null) !== canonicalJSON(expectedClassifier ?? null)) throw new Error("server classifier settings differ from configured job");
  if (!session.tools.length) throw new Error("server did not expose tools for fingerprinting");
  const fingerprint = { prompt: hashText(session.instructions ?? ""), tools: hashText(canonicalJSON(session.tools)),
    observedSettings: { ...runtime.settings },
    extra: { ...runtime.prompts, catalog: runtime.catalogHash, settings: hashText(canonicalJSON(runtime.settings)) } };
  if ((provenance.integrity.runtimePlatform !== undefined && canonicalJSON(provenance.integrity.runtimePlatform) !== canonicalJSON(runtime.runtimePlatform)) ||
      (provenance.integrity.nodeVersion !== undefined && provenance.integrity.nodeVersion !== runtime.nodeVersion) ||
      (provenance.engine !== "pending" && provenance.engine !== runtime.engine) ||
      (Object.hasOwn(provenance.images, problem) && provenance.images[problem] !== image) ||
      (Object.hasOwn(provenance.frameworks, framework) && canonicalJSON(provenance.frameworks[framework]) !== canonicalJSON(fingerprint))) throw new Error("runtime provenance changed between jobs");
  provenance.engine = runtime.engine;
  provenance.integrity.nodeVersion = runtime.nodeVersion;
  provenance.integrity.runtimePlatform = runtime.runtimePlatform;
  Object.defineProperty(provenance.images, problem, { value: image, enumerable: true, configurable: true, writable: true });
  Object.defineProperty(provenance.frameworks, framework, { value: fingerprint, enumerable: true, configurable: true, writable: true });
  provenance.integrity.runtime = config.problems.every((id) => Object.hasOwn(provenance.images, id)) && config.frameworks.every((id) => Object.hasOwn(provenance.frameworks, id)) ? "observed" : "pending";
}
/** A completed new-format run must contain every selected runtime observation. */
export function assertCompleteProvenance(provenance: Provenance, config: RunConfig): void {
  if (!config.problems.length || !config.frameworks.length || !provenance.integrity || provenance.integrity.runtime !== "observed" || !HASH.test(provenance.integrity.sourceHash) || !HASH.test(provenance.integrity.bundleHash) || !HASH.test(provenance.integrity.entryHash) || provenance.engine !== "isolated-vm" || !provenance.integrity.nodeVersion || !provenance.integrity.runtimePlatform || provenance.integrity.configHash !== hashText(canonicalJSON(config)) ||
      !config.problems.every((id) => IMAGE.test(provenance.images[id] ?? "") && HASH.test(provenance.problems[id]?.taskHash ?? "")) ||
      !config.frameworks.every((id) => HASH.test(provenance.frameworks[id]?.prompt ?? "") && HASH.test(provenance.frameworks[id]?.tools ?? ""))) throw new Error("run provenance is incomplete");
}
