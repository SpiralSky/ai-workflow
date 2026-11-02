/**
 * Grading: diff the container's /work against the pristine workspace, then run check.sh.
 * Runner architecture §6.
 */

import { execFile as _execFile } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";

import { problemImageRef, type Container } from "./container.ts";

const execFile = promisify(_execFile);

/** Build the offline grading container command using the shared case-preserving image reference. */
export function gradingContainerArgs(problem: string, imageId?: string): string[] {
  if (imageId !== undefined && !/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("grading requires an immutable observed image ID");
  return ["run", "-d", "--network", "none", imageId ?? problemImageRef(problem), "sleep", "infinity"];
}

/** Grading result. */
export interface GradeResult {
  pass: boolean;
  /** True only when the check wrapper reports a completed script exit, not a timeout/transport failure. */
  checksCompleted?: boolean;
  reason?: "checks" | "patch-failed";
  /** Path to diff.patch written by the grader. */
  diffPatch?: string;
  /** Path to check.log written by the grader. */
  checkLog?: string;
}

/** Run checks with explicit completion evidence, distinguishing Docker failures from script exits. */
export async function runGradingChecks(containerId: string,
  run: (command: string, args: string[], options: { maxBuffer: number }) => Promise<{ stdout: string; stderr: string }> = execFile,
): Promise<{ output: string; exitCode: number; completed: boolean }> {
  const marker = `AIW_CHECK_EXIT_${randomUUID()}`;
  const command = `cd /work && timeout 120 sh -c 'sh checks/check.sh; result=$?; printf "\\n${marker}:%s\\n" "$result" >&2; exit "$result"'`;
  let stdout = "", stderr = "", exitCode = 0, failure: unknown;
  try {
    ({ stdout, stderr } = await run("docker", ["exec", containerId, "sh", "-c", command], { maxBuffer: 10 * 1024 * 1024 }));
  } catch (error) {
    failure = error;
    const e = error as NodeJS.ErrnoException & { stdout?: string; stderr?: string };
    stdout = typeof e.stdout === "string" ? e.stdout : "";
    stderr = typeof e.stderr === "string" ? e.stderr : "";
    exitCode = typeof e.code === "number" ? e.code : -1;
  }
  const completion = new RegExp(`\\n${marker}:(\\d+)\\n$`).exec(stderr);
  // Preserve grading's timeout-as-failure outcome, but it cannot prove the empty fixture failed checks.
  if (!completion && exitCode === 124) return { output: stdout + stderr, exitCode, completed: false };
  if (!completion || Number(completion[1]) !== exitCode || exitCode < 0 || exitCode > 255) {
    throw new Error("grading checks did not report a completed exit status", { cause: failure });
  }
  return { output: stdout + stderr.slice(0, completion.index), exitCode, completed: true };
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
  imageId?: string,
): Promise<GradeResult> {
  if (imageId !== undefined && !/^sha256:[a-f0-9]{64}$/.test(imageId)) throw new Error("grading image must be an immutable sha256 ID");
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
    const { stdout: runOut } = await execFile("docker", gradingContainerArgs(ctr.problem, imageId));
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

    // 6. Copy checks/ directory into /work/ so check.sh lands at /work/checks/check.sh
    await execFile("docker", [
      "exec",
      gradeId,
      "sh",
      "-c",
      "cp -r /tmp/checks /work/",
    ]);

    // 7. Run check.sh with 120 s timeout
    const checkLogPath = join(jobDir, "check.log");
    const checkResult = await runGradingChecks(gradeId);
    const checkOutput = checkResult.output;
    const checkExitCode = checkResult.exitCode;
    await writeFile(checkLogPath, checkOutput);

    // 8. Cleanup grading container and tmp dir
    await execFile("docker", ["rm", "-f", gradeId]).catch(() => void 0);
    gradeId = undefined;
    await rm(tmp, { recursive: true, force: true });

    // 9. Return result
    if (checkExitCode === 0) {
      return { pass: true, checksCompleted: checkResult.completed, diffPatch: diffPatchPath, checkLog: checkLogPath };
    }
    return { pass: false, reason: "checks", checksCompleted: checkResult.completed, diffPatch: diffPatchPath, checkLog: checkLogPath };
  } finally {
    // Always clean up on failure
    if (gradeId) {
      await execFile("docker", ["rm", "-f", gradeId]).catch(() => void 0);
    }
    await rm(tmp, { recursive: true, force: true }).catch(() => void 0);
  }
}
