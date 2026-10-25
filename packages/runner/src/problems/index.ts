/**
 * `aiw problems build` and `aiw problems check` commands.
 * Problems §5–7.
 */

import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import { readdir, readFile, access, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

const execFile = promisify(_execFile);

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
    if (!e.isDirectory()) continue;
    const taskPath = join(problemsDir, e.name, "task.json");
    try {
      await access(taskPath);
      ids.push(e.name);
    } catch {
      // no task.json — skip
    }
  }
  return ids;
}

/**
 * Reads and parses task.json for a given problem.
 */
async function readTaskJson(problemsDir: string, id: string): Promise<TaskJson> {
  const raw = await readFile(join(problemsDir, id, "task.json"), "utf8");
  return JSON.parse(raw) as TaskJson;
}

/**
 * Builds problem workspaces for the given problem ids (or all if none given).
 * Creates the workspace directory from the codebase + overlay.
 * @param problemIds - problem ids to build (empty = all)
 * @param problemsDir - path to experiments/problems/
 */
export async function buildProblems(problemIds: string[], problemsDir: string): Promise<void> {
  const ids = problemIds.length > 0 ? problemIds : await allProblemIds(problemsDir);

  for (const id of ids) {
    process.stderr.write(`[problems] building ${id}...\n`);
    const task = await readTaskJson(problemsDir, id);
    const problemDir = join(problemsDir, id);

    if (task.size === "large") {
      const cb = task.codebase;
      if (!cb) throw new Error(`problem ${id}: task.json has size=large but no codebase field`);

      const codebaseDir = join(problemsDir, "_codebases", cb);

      // Verify codebase tests (best-effort — skip if base image is missing)
      try {
        await execFile("docker", [
          "run",
          "--rm",
          "-v",
          `${codebaseDir}:/work`,
          "-w",
          "/work",
          "aiw-base:latest",
          "python",
          "-m",
          "unittest",
          "discover",
        ], { maxBuffer: 10 * 1024 * 1024 });
      } catch (err: unknown) {
        const e = err as Error & { stderr?: string };
        if (typeof e.message === "string" && e.message.includes("No such image")) {
          process.stderr.write(`[problems] warning: aiw-base:latest not found, skipping codebase test for ${id}\n`);
        } else {
          process.stderr.write(`[problems] warning: codebase tests failed for ${id}: ${e.message}\n`);
        }
      }

      // Copy codebase → workspace/
      const workspaceDir = join(problemDir, "workspace");
      await rm(workspaceDir, { recursive: true, force: true });
      await execFile("cp", ["-r", codebaseDir + "/.", workspaceDir]);

      // Apply overlay if present
      const overlayDir = join(problemDir, "overlay");
      try {
        await access(overlayDir);
        await execFile("cp", ["-r", overlayDir + "/.", workspaceDir]);

        // Process .delete file if present
        const deleteFile = join(problemDir, "overlay", ".delete");
        try {
          const deleteList = await readFile(deleteFile, "utf8");
          for (const line of deleteList.split("\n").map((l) => l.trim()).filter(Boolean)) {
            await rm(join(workspaceDir, line), { recursive: true, force: true });
          }
        } catch {
          // no .delete file — fine
        }
      } catch {
        // no overlay — fine
      }

      // Strip .git/ and __pycache__/
      await rm(join(workspaceDir, ".git"), { recursive: true, force: true });
      await execFile("find", [workspaceDir, "-name", "__pycache__", "-type", "d", "-exec", "rm", "-rf", "{}", "+"])
        .catch(() => void 0);
    }

    // Generate .dockerignore
    const dockerIgnorePath = join(problemDir, ".dockerignore");
    await writeFile(dockerIgnorePath, "*\n!workspace/\n");

    process.stderr.write(`[problems] built ${id}\n`);
  }
}

/**
 * Computes sha256 over sorted file list + contents of the task folder,
 * excluding reference/ and .selfcheck.json.
 */
async function hashTaskFolder(problemDir: string): Promise<string> {
  const hash = createHash("sha256");

  async function addDir(dir: string, prefix: string): Promise<void> {
    let entries: string[];
    try {
      entries = (await readdir(dir)).sort();
    } catch {
      return;
    }
    for (const name of entries) {
      if (name === "reference" && prefix === "") continue;
      if (name === ".selfcheck.json" && prefix === "") continue;
      const fullPath = join(dir, name);
      const s = await stat(fullPath);
      const relPath = prefix ? `${prefix}/${name}` : name;
      if (s.isDirectory()) {
        await addDir(fullPath, relPath);
      } else {
        hash.update(relPath);
        hash.update(await readFile(fullPath));
      }
    }
  }

  await addDir(problemDir, "");
  return hash.digest("hex");
}

/**
 * Runs the self-check for the given problem ids (or all if none given).
 * Validates that the empty-diff case fails and the reference solution passes.
 * @param problemIds - problem ids to check (empty = all)
 * @param problemsDir - path to experiments/problems/
 */
export async function checkProblems(problemIds: string[], problemsDir: string): Promise<void> {
  const { buildImage, startContainer, removeContainer } = await import("../container.ts");
  const { gradeJob } = await import("../grade.ts");

  const ids = problemIds.length > 0 ? problemIds : await allProblemIds(problemsDir);
  const failures: string[] = [];

  for (const id of ids) {
    process.stderr.write(`[problems] checking ${id}...\n`);
    const problemDir = join(problemsDir, id);

    // Warn if workspace is missing
    try {
      await access(join(problemDir, "workspace"));
    } catch {
      process.stderr.write(`[problems] warning: workspace missing for ${id}, skipping\n`);
      continue;
    }

    try {
      const checkStart = Date.now();

      // Build image
      await buildImage(problemDir, id);

      // Step 2: empty diff — expect fail
      const ctr2 = await startContainer(id, problemDir, problemDir);
      try {
        const emptyResult = await gradeJob(ctr2, problemDir, problemDir);
        if (emptyResult.pass) {
          throw new Error(`${id}: empty diff unexpectedly passed`);
        }
      } finally {
        await removeContainer(ctr2).catch(() => void 0);
      }

      // Step 3: apply solution.patch — expect pass
      const solutionPatch = join(problemDir, "reference", "solution.patch");
      const step3Start = Date.now();

      const ctr3 = await startContainer(id, problemDir, problemDir);
      try {
        await execFile("docker", ["cp", solutionPatch, `${ctr3.id}:/tmp/solution.patch`]);
        await execFile("docker", [
          "exec",
          ctr3.id,
          "sh",
          "-c",
          "cd /work && git apply --binary /tmp/solution.patch",
        ]);
        const sol3Result = await gradeJob(ctr3, problemDir, problemDir);
        if (!sol3Result.pass) {
          throw new Error(`${id}: solution.patch failed to produce a passing grade`);
        }
      } finally {
        await removeContainer(ctr3).catch(() => void 0);
      }

      const step3DurationMs = Date.now() - step3Start;
      if (step3DurationMs > 30_000) {
        throw new Error(`${id}: step 3 took ${step3DurationMs}ms (> 30 s)`);
      } else if (step3DurationMs > 20_000) {
        process.stderr.write(`[problems] warning: ${id} step 3 took ${step3DurationMs}ms (> 20 s)\n`);
      }

      // Step 4: stability — 4 more runs of solution.patch
      for (let i = 0; i < 4; i++) {
        const ctrN = await startContainer(id, problemDir, problemDir);
        try {
          await execFile("docker", ["cp", solutionPatch, `${ctrN.id}:/tmp/solution.patch`]);
          await execFile("docker", [
            "exec",
            ctrN.id,
            "sh",
            "-c",
            "cd /work && git apply --binary /tmp/solution.patch",
          ]);
          const stabResult = await gradeJob(ctrN, problemDir, problemDir);
          if (!stabResult.pass) {
            throw new Error(`${id}: stability run ${i + 2} failed`);
          }
        } finally {
          await removeContainer(ctrN).catch(() => void 0);
        }
      }

      // Step 5: fixWords check
      const notesPath = join(problemDir, "reference", "notes.md");
      try {
        const notesRaw = await readFile(notesPath, "utf8");
        // Parse front-matter for fixWords: [...]
        const fmMatch = notesRaw.match(/^---\n([\s\S]*?)\n---/);
        if (fmMatch) {
          const fm = fmMatch[1];
          const fwMatch = fm.match(/fixWords:\s*\[([^\]]*)\]/);
          if (fwMatch) {
            const fixWords = fwMatch[1]
              .split(",")
              .map((w) => w.trim().replace(/^["']|["']$/g, ""))
              .filter(Boolean);
            const taskMd = await readFile(join(problemDir, "task.md"), "utf8").catch(() => "");
            for (const word of fixWords) {
              const re = new RegExp(`\\b${word}\\b`, "i");
              if (re.test(taskMd)) {
                throw new Error(`${id}: fixWord "${word}" found in task.md`);
              }
            }
          }
        }
      } catch (err: unknown) {
        const e = err as NodeJS.ErrnoException;
        if (e.code !== "ENOENT") throw err;
        // no notes.md — skip fixWords check
      }

      // Step 6: Write .selfcheck.json
      const checkDurationMs = Date.now() - checkStart;
      const taskHash = await hashTaskFolder(problemDir);
      await writeFile(
        join(problemDir, ".selfcheck.json"),
        JSON.stringify(
          { pass: true, taskHash, checkedAt: new Date().toISOString(), checkDurationMs },
          null,
          2,
        ),
      );

      process.stderr.write(`[problems] ${id}: PASS (${checkDurationMs}ms)\n`);
    } catch (err: unknown) {
      const e = err as Error;
      process.stderr.write(`[problems] ${id}: FAIL — ${e.message}\n`);
      failures.push(id);
    }
  }

  if (failures.length > 0) {
    throw new Error(`checkProblems failed for: ${failures.join(", ")}`);
  }
}
