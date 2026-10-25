/**
 * Grading: diff the container's /work against the pristine workspace, then run check.sh.
 * Runner architecture §6.
 */

import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

import type { Container } from "./container.ts";

const execFile = promisify(_execFile);

/** Grading result. */
export interface GradeResult {
  pass: boolean;
  reason?: "checks" | "patch-failed";
  /** Path to diff.patch written by the grader. */
  diffPatch?: string;
  /** Path to check.log written by the grader. */
  checkLog?: string;
}

/**
 * Grades a job: exports /work from the container, computes a diff against the pristine workspace,
 * applies the diff in a fresh container, and runs check.sh.
 * @param ctr - the job container (server already stopped, /work ready)
 * @param problemDir - path to the problem directory on the host (contains workspace/ and checks/)
 * @param jobDir - job output directory to write diff.patch and check.log into
 * @returns grading result
 */
export async function gradeJob(
  ctr: Container,
  problemDir: string,
  jobDir: string,
): Promise<GradeResult> {
  const tmp = await mkdtemp(join(tmpdir(), "aiw-grade-"));
  const afterDir = join(tmp, "after");
  let gradeId: string | undefined;

  try {
    // 1. Copy /work from container to afterDir
    await execFile("docker", ["cp", `${ctr.id}:/work`, afterDir]);

    // Pre-delete excluded dirs/files from afterDir before diffing
    await rm(join(afterDir, ".git"), { recursive: true, force: true });
    await rm(join(afterDir, "node_modules"), { recursive: true, force: true });
    await rm(join(afterDir, "__pycache__"), { recursive: true, force: true });
    await rm(join(afterDir, ".pytest_cache"), { recursive: true, force: true });
    await rm(join(afterDir, ".venv"), { recursive: true, force: true });
    // Remove .pyc files
    await execFile("find", [afterDir, "-name", "*.pyc", "-delete"]).catch(() => void 0);

    // 2. Compute diff against pristine workspace.
    // Copy workspaceDir to tmp/before so git diff uses relative paths (before/file, after/file).
    // A symlink would be diffed as a file by git --no-index, so we need a real copy.
    // -p2 in git apply strips both the a/b prefix and the before/after component, yielding
    // plain file paths that match /work/ inside the grading container.
    const diffPatchPath = join(jobDir, "diff.patch");
    const workspaceDir = join(problemDir, "workspace");
    await cp(workspaceDir, join(tmp, "before"), { recursive: true });

    let diffOutput = "";
    try {
      const { stdout } = await execFile(
        "git",
        [
          "diff",
          "--no-index",
          "--binary",
          "--diff-filter=ACMRDT",
          "--",
          "before",
          "after",
        ],
        { cwd: tmp, maxBuffer: 10 * 1024 * 1024 },
      );
      diffOutput = stdout;
    } catch (err: unknown) {
      // git diff --no-index exits 1 when differences exist (normal); re-throw on anything else
      const e = err as NodeJS.ErrnoException & { stdout?: string };
      if (String(e.code) === "1") {
        diffOutput = e.stdout ?? "";
      } else {
        throw err;
      }
    }

    await writeFile(diffPatchPath, diffOutput);

    // 3. Start fresh grading container (network none, same image)
    const tag = `aiw-problem-${ctr.problem}`;
    const { stdout: runOut } = await execFile("docker", [
      "run",
      "-d",
      "--network",
      "none",
      tag,
      "sleep",
      "infinity",
    ]);
    gradeId = runOut.trim();

    // 4. Copy diff.patch and checks/ into the fresh container
    await execFile("docker", ["cp", diffPatchPath, `${gradeId}:/tmp/diff.patch`]);
    await execFile("docker", ["cp", `${join(problemDir, "checks")}/.`, `${gradeId}:/tmp/checks`]);

    // 5. Apply the patch if non-empty
    const diffStat = await stat(diffPatchPath);
    if (diffStat.size > 0) {
      try {
        await execFile("docker", [
          "exec",
          gradeId,
          "sh",
          "-c",
          "cd /work && git apply --binary -p2 /tmp/diff.patch",
        ]);
      } catch {
        await execFile("docker", ["rm", "-f", gradeId]).catch(() => void 0);
        gradeId = undefined;
        return { pass: false, reason: "patch-failed" };
      }
    }

    // 6. Copy checks over workspace
    await execFile("docker", [
      "exec",
      gradeId,
      "sh",
      "-c",
      "cp -r /tmp/checks/. /work/",
    ]);

    // 7. Run check.sh with 120 s timeout
    const checkLogPath = join(jobDir, "check.log");
    let checkOutput = "";
    let checkExitCode = 0;
    try {
      const { stdout: cOut, stderr: cErr } = await execFile(
        "docker",
        ["exec", gradeId, "sh", "-c", "cd /work && timeout 120 sh checks/check.sh"],
        { maxBuffer: 10 * 1024 * 1024 },
      );
      checkOutput = cOut + cErr;
    } catch (err: unknown) {
      const e = err as NodeJS.ErrnoException & { code?: number | string; stdout?: string; stderr?: string };
      checkExitCode = typeof e.code === "number" ? e.code : 1;
      checkOutput = (e.stdout ?? "") + (e.stderr ?? "");
    }
    await writeFile(checkLogPath, checkOutput);

    // 8. Cleanup grading container and tmp dir
    await execFile("docker", ["rm", "-f", gradeId]).catch(() => void 0);
    gradeId = undefined;
    await rm(tmp, { recursive: true, force: true });

    // 9. Return result
    if (checkExitCode === 0) {
      return { pass: true, diffPatch: diffPatchPath, checkLog: checkLogPath };
    }
    return { pass: false, reason: "checks", diffPatch: diffPatchPath, checkLog: checkLogPath };
  } finally {
    // Always clean up on failure
    if (gradeId) {
      await execFile("docker", ["rm", "-f", gradeId]).catch(() => void 0);
    }
    await rm(tmp, { recursive: true, force: true }).catch(() => void 0);
  }
}
