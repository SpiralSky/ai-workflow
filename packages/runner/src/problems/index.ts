/**
 * `aiw problems build` and `aiw problems check` commands.
 * Problems §5–7.
 */

import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, access, rm, writeFile, lstat, cp, mkdtemp } from "node:fs/promises";
import { join, resolve, relative, isAbsolute, sep } from "node:path";
import { tmpdir } from "node:os";
import { hashTree, problemHash, selfcheckInputHash, problemDirectory, requireRealDirectory } from "../provenance.ts";

import { PROBLEM_DOCKERIGNORE } from "../build-context.ts";

const execFile = promisify(_execFile);

/** Injectable process boundary for offline tests; production always uses execFile. */
export type ProblemCommand = (command: string, args: string[], options?: { maxBuffer?: number }) => Promise<{ stdout: string; stderr: string }>;

/** Shape of task.json in each problem directory. */
interface TaskJson {
  size: "smoke" | "small" | "large";
  set: string;
  turnLimit: number;
  codebase?: string;
  [k: string]: unknown;
}

/**
 * Returns all problem ids by scanning problemsDir for subdirectories containing task.json.
 */
async function allProblemIds(problemsDir: string): Promise<string[]> {
  const entries = await readdir(problemsDir, { withFileTypes: true });
  const ids: string[] = [];
  for (const e of entries) {
    if (e.isSymbolicLink()) throw new Error("problem entries must not be symbolic links");
    if (!e.isDirectory()) continue;
    const taskPath = join(problemsDir, e.name, "task.json");
    try {
      await access(taskPath);
      ids.push(e.name);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      // Non-problem support directories have no task.json.
    }
  }
  return ids;
}

/**
 * Reads and parses task.json for a given problem.
 */
async function readTaskJson(problemsDir: string, id: string): Promise<TaskJson> {
  const path = join(problemsDir, id, "task.json");
  if (!(await lstat(path)).isFile()) throw new Error(`problem ${id}: task.json must be a regular file`);
  const raw = await readFile(path, "utf8");
  return JSON.parse(raw) as TaskJson;
}

/** Resolve all selected owned inputs before a command can invalidate stamps or replace workspaces. */
async function problemInputs(ids: string[], problemsDir: string) {
  const directories = ids.map(id => ({ id, problemDir: problemDirectory(problemsDir, id) }));
  return Promise.all(directories.map(async ({ id, problemDir }) => {
    const task = await readTaskJson(problemsDir, id);
    const codebaseDir = task.size === "large" ? problemDirectory(join(problemsDir, "_codebases"), task.codebase!) : undefined;
    for (const name of [".dockerignore", ".selfcheck.json", "workspace"]) {
      try {
        const entry = await lstat(join(problemDir, name));
        if (name === "workspace" ? !entry.isDirectory() : !entry.isFile()) {
          throw new Error(`problem ${id}: ${name} must not be a symbolic link or special file`);
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      }
    }
    return { id, problemDir, task, codebaseDir };
  }));
}

/** Reject links along an existing path so copy/delete cannot traverse outside the workspace. */
async function rejectSymlinkPath(root: string, path: string): Promise<void> {
  const parts = relative(root, path).split(sep).filter(Boolean);
  let current = root;
  for (const part of ["", ...parts]) {
    if (part) current = join(current, part);
    try {
      if ((await lstat(current)).isSymbolicLink()) {
        throw new Error(`overlay path traverses a symbolic link: ${current}`);
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
      throw error;
    }
  }
}

/**
 * Apply overlay files, then consume (never copy) its root .delete control file.
 * Reject unsafe deletion paths and symlink traversal before modifying the workspace.
 * Missing overlays/control files are allowed; malformed files and I/O failures propagate.
 */
export async function applyProblemOverlay(overlayDir: string, workspaceDir: string): Promise<void> {
  const root = resolve(workspaceDir);
  try {
    if (!(await lstat(overlayDir)).isDirectory()) throw new Error("overlay must be a directory, not a symlink");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return;
    throw error;
  }
  await rejectSymlinkPath(root, root);
  const controlFile = join(overlayDir, ".delete");
  let deleteList = "";
  try {
    if (!(await lstat(controlFile)).isFile()) throw new Error("overlay .delete must be a regular file");
    deleteList = await readFile(controlFile, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const targets = deleteList.split("\n").map((line) => line.trim()).filter(Boolean).map((line) => {
    const target = resolve(root, line);
    const rel = relative(root, target);
    if (isAbsolute(line) || line.includes("\0") || line.split(/[\\/]/).includes("..") ||
        !rel || rel === ".." || rel.startsWith(`..${sep}`) || isAbsolute(rel)) {
      throw new Error(`unsafe overlay .delete path: ${line}`);
    }
    return target;
  });
  for (const target of targets) await rejectSymlinkPath(root, target);

  /** Preflight copy destinations too: an existing link must not redirect overlay writes. */
  async function validateCopy(dir: string, prefix = ""): Promise<void> {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      if (!prefix && entry.name === ".delete") continue;
      const rel = join(prefix, entry.name);
      if (entry.isSymbolicLink()) throw new Error(`overlay symbolic links are unsupported: ${rel}`);
      await rejectSymlinkPath(root, join(root, rel));
      if (entry.isDirectory()) await validateCopy(join(dir, entry.name), rel);
    }
  }
  await validateCopy(overlayDir);
  await cp(overlayDir, root, {
    recursive: true,
    filter: (source) => resolve(source) !== resolve(controlFile),
  });
  for (const target of targets) await rm(target, { recursive: true, force: true });
}

/**
 * Builds problem workspaces for the given problem ids (or all if none given).
 * Creates the workspace directory from the codebase + overlay.
 * @param problemIds - problem ids to build (empty = all)
 * @param problemsDir - path to experiments/problems/
 */
export async function buildProblems(problemIds: string[], problemsDir: string, run: ProblemCommand = execFile): Promise<void> {
  requireRealDirectory(problemsDir);
  const ids = problemIds.length > 0 ? problemIds : await allProblemIds(problemsDir);
  if (!ids.length) throw new Error("no problem fixtures selected");

  const inputs = await problemInputs(ids, problemsDir);
  for (const { id, problemDir, codebaseDir } of inputs) {
    process.stderr.write(`[problems] building ${id}...\n`);
    await rm(join(problemDir, ".selfcheck.json"), { force: true });

    if (codebaseDir) {
      const codebaseHash = hashTree(codebaseDir);

      // Clean-base validation is mandatory: missing Docker/image and failing tests all block.
      try {
        await run("docker", ["run", "--rm", "--network", "none", "-v", `${codebaseDir}:/work:ro`,
          "-w", "/work", "aiw-base:latest", "python", "-B", "-c",
          "import sys, unittest; suite = unittest.defaultTestLoader.discover('.'); " +
          "count = suite.countTestCases(); " +
          "sys.exit(2) if count == 0 else None; " +
          "result = unittest.TextTestRunner(verbosity=2).run(suite); " +
          "sys.exit(not (result.wasSuccessful() and result.testsRun == count and " +
          "not (result.skipped or result.expectedFailures or result.unexpectedSuccesses)))"],
          { maxBuffer: 10 * 1024 * 1024 });
      } catch (error) {
        throw new Error(`problem ${id}: clean codebase tests failed; workspace was not rebuilt: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
      }

      if (hashTree(codebaseDir) !== codebaseHash) throw new Error(`problem ${id}: clean codebase changed during validation`);

      // Copy codebase → workspace/
      const workspaceDir = join(problemDir, "workspace");
      await rm(workspaceDir, { recursive: true, force: true });
      await run("cp", ["-r", codebaseDir + "/.", workspaceDir]);
      if (hashTree(codebaseDir) !== codebaseHash || hashTree(workspaceDir) !== codebaseHash) {
        throw new Error(`problem ${id}: clean codebase changed during materialization`);
      }

      await applyProblemOverlay(join(problemDir, "overlay"), workspaceDir);

      // Strip .git/ and __pycache__/
      await rm(join(workspaceDir, ".git"), { recursive: true, force: true });
      await run("find", [workspaceDir, "-name", "__pycache__", "-type", "d", "-exec", "rm", "-rf", "{}", "+"])
        .catch(() => void 0);
    }

    // Generate .dockerignore
    const dockerIgnorePath = join(problemDir, ".dockerignore");
    await writeFile(dockerIgnorePath, PROBLEM_DOCKERIGNORE);

    process.stderr.write(`[problems] built ${id}\n`);
  }
}

/** Narrow fakeable boundaries; tests cannot bypass validation logic or stamp creation. */
export interface SelfcheckDependencies {
  run?: ProblemCommand;
  buildImage?: typeof import("../container.ts").buildImage;
  startContainer?: typeof import("../container.ts").startContainer;
  removeContainer?: typeof import("../container.ts").removeContainer;
  gradeJob?: typeof import("../grade.ts").gradeJob;
}

/**
 * Runs the self-check for the given problem ids (or all if none given).
 * Validates that the empty-diff case fails and the reference solution passes.
 * @param problemIds - problem ids to check (empty = all)
 * @param problemsDir - path to experiments/problems/
 */
export async function checkProblems(problemIds: string[], problemsDir: string, deps: SelfcheckDependencies = {}): Promise<void> {
  const container = await import("../container.ts");
  const grading = await import("../grade.ts");
  const { buildImage = container.buildImage, startContainer = container.startContainer,
    removeContainer = container.removeContainer, gradeJob = grading.gradeJob, run = execFile } = deps;

  requireRealDirectory(problemsDir);
  const ids = problemIds.length > 0 ? problemIds : await allProblemIds(problemsDir);
  if (!ids.length) throw new Error("no problem fixtures selected");
  await problemInputs(ids, problemsDir);
  const failures: string[] = [];
  // Check every required workspace before starting any image/container operation.
  for (const id of ids) {
    try {
      if (!(await lstat(join(problemsDir, id, "workspace"))).isDirectory()) throw new Error("not a directory");
    } catch (error) {
      await rm(join(problemsDir, id, ".selfcheck.json"), { force: true });
      throw new Error(`checkProblems failed for ${id}: required workspace missing or invalid`, { cause: error });
    }
  }

  for (const id of ids) {
    process.stderr.write(`[problems] checking ${id}...\n`);
    const problemDir = join(problemsDir, id);

    let outputDir: string | undefined;
    try {
      // Invalidate previous success even if this attempt fails before any grade.
      await rm(join(problemDir, ".selfcheck.json"), { force: true });
      if (!(await lstat(join(problemDir, "workspace"))).isDirectory()) throw new Error(`${id}: workspace must be a directory`);
      await buildProblems([id], problemsDir, run);
      const checkStart = Date.now();
      const inputHash = selfcheckInputHash(problemDir);
      outputDir = await mkdtemp(join(tmpdir(), "aiw-selfcheck-"));

      // Build image
      await buildImage(problemDir, id);

      // Step 2: empty diff — expect fail
      const ctr2 = await startContainer(id, outputDir, outputDir);
      try {
        const emptyResult = await gradeJob(ctr2, problemDir, outputDir);
        if (emptyResult.pass || emptyResult.reason !== "checks" || emptyResult.checksCompleted !== true) {
          throw new Error(`${id}: empty diff must fail its checks, not pass or fail patch application`);
        }
      } finally {
        await removeContainer(ctr2).catch(() => void 0);
      }

      // Step 3: apply solution.patch — expect pass
      const solutionPatch = join(problemDir, "reference", "solution.patch");
      const step3Start = Date.now();

      const ctr3 = await startContainer(id, outputDir, outputDir);
      try {
        await run("docker", ["cp", solutionPatch, `${ctr3.id}:/tmp/solution.patch`]);
        await run("docker", [
          "exec",
          ctr3.id,
          "sh",
          "-c",
          "cd /work && git apply --binary /tmp/solution.patch",
        ]);
        const sol3Result = await gradeJob(ctr3, problemDir, outputDir);
        if (!sol3Result.pass || sol3Result.checksCompleted !== true) {
          throw new Error(`${id}: solution.patch failed to produce a passing grade`);
        }
      } finally {
        await removeContainer(ctr3).catch(() => void 0);
      }

      const step3DurationMs = Date.now() - step3Start;
      if (step3DurationMs >= 30_000) {
        throw new Error(`${id}: step 3 took ${step3DurationMs}ms (>= 30 s)`);
      } else if (step3DurationMs >= 20_000) {
        process.stderr.write(`[problems] warning: ${id} step 3 took ${step3DurationMs}ms (>= 20 s)\n`);
      }

      // Step 4: stability — five repetitions after the initial solved grade.
      for (let i = 0; i < 5; i++) {
        const ctrN = await startContainer(id, outputDir, outputDir);
        try {
          await run("docker", ["cp", solutionPatch, `${ctrN.id}:/tmp/solution.patch`]);
          await run("docker", [
            "exec",
            ctrN.id,
            "sh",
            "-c",
            "cd /work && git apply --binary /tmp/solution.patch",
          ]);
          const stabResult = await gradeJob(ctrN, problemDir, outputDir);
          if (!stabResult.pass || stabResult.checksCompleted !== true) {
            throw new Error(`${id}: stability run ${i + 2} failed`);
          }
        } finally {
          await removeContainer(ctrN).catch(() => void 0);
        }
      }

      // Step 5: fixWords check
      const notesRaw = await readFile(join(problemDir, "reference", "notes.md"), "utf8");
      const fmMatch = notesRaw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
      const declarations = fmMatch?.[1].split(/\r?\n/).filter(line => /^fixWords\s*:/.test(line)) ?? [];
      const fwMatch = declarations.length === 1 ? declarations[0].match(/^fixWords:\s*\[([^\]]*)\]\s*$/) : null;
      if (!fwMatch) throw new Error(`${id}: notes.md must declare exactly one fixWords: [...] front matter field`);
      const fixWords = fwMatch[1].trim() === "" ? [] : fwMatch[1].split(",").map((value) => {
        const word = value.trim();
        if (/^"(?:[^"\\]|\\.)*"$/.test(word)) return JSON.parse(word) as string;
        if (/^'(?:[^']|'')*'$/.test(word)) return word.slice(1, -1).replace(/''/g, "'");
        if (!word || /["'\[\]#:]/.test(word)) throw new Error(`${id}: malformed inline fixWords list`);
        return word;
      });
      if (fixWords.some(word => !word.trim())) throw new Error(`${id}: empty fixWord is invalid`);
      const taskMd = await readFile(join(problemDir, "task.md"), "utf8");
      for (const word of fixWords) {
        const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`\\b${escaped}\\b`, "i").test(taskMd)) throw new Error(`${id}: fixWord "${word}" found in task.md`);
      }

      // Step 6: Write .selfcheck.json
      const checkDurationMs = Date.now() - checkStart;
      const taskHash = problemHash(problemDir);
      if (selfcheckInputHash(problemDir) !== inputHash) throw new Error(`${id}: self-check inputs changed during validation`);
      await writeFile(
        join(problemDir, ".selfcheck.json"),
        JSON.stringify(
          { version: 1, pass: true, taskHash, inputHash, checkedAt: new Date().toISOString(), checkDurationMs },
          null,
          2,
        ),
      );

      process.stderr.write(`[problems] ${id}: PASS (${checkDurationMs}ms)\n`);
    } catch (err: unknown) {
      const e = err as Error;
      process.stderr.write(`[problems] ${id}: FAIL — ${e.message}\n`);
      failures.push(id);
      break;
    } finally {
      if (outputDir) await rm(outputDir, { recursive: true, force: true });
    }
  }

  if (failures.length > 0) {
    throw new Error(`checkProblems failed for: ${failures.join(", ")}`);
  }
}
