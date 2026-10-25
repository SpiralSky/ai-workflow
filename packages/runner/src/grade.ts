/**
 * Grading: diff the container's /work against the pristine workspace, then run check.sh.
 * Runner architecture §6.
 *
 * TODO: All functions are stubs. Implement using docker cp and a fresh container per §6.
 */

import type { Container } from "./container.ts";

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
  _ctr: Container,
  _problemDir: string,
  _jobDir: string,
): Promise<GradeResult> {
  // TODO: implement per runner §6:
  //   1. docker cp <ctr>:/work <tmp>/after
  //   2. git diff --no-index --binary <problemDir>/workspace <tmp>/after > diff.patch
  //   3. Fresh container, docker cp diff.patch and checks/ in, git apply, run check.sh
  //   4. Exit 0 → pass; non-zero → fail with reason "checks"; apply failure → "patch-failed"
  console.error("[grade stub] gradeJob: grading not implemented");
  return { pass: false, reason: "checks" };
}
