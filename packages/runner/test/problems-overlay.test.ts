import { test, type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from "node:fs/promises";
import { join } from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { tmpdir } from "node:os";
import { applyProblemOverlay } from "../src/problems/index.ts";

/** Temporary fixtures only; no repository problem/workspace is modified. */
async function fixture(t: TestContext) {
  const dir = await mkdtemp(join(tmpdir(), "aiw-overlay-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const overlay = join(dir, "overlay");
  const workspace = join(dir, "workspace");
  await mkdir(overlay);
  await mkdir(workspace);
  await writeFile(join(workspace, "keep.txt"), "base");
  await writeFile(join(workspace, "remove.txt"), "remove");
  await writeFile(join(dir, "outside.txt"), "untouched");
  return { dir, overlay, workspace };
}

test("overlay consumes root .delete without leaking it and preserves nested ordinary files", async (t) => {
  const { overlay, workspace } = await fixture(t);
  await mkdir(join(overlay, "nested"));
  await writeFile(join(overlay, "nested", ".delete"), "ordinary nested data");
  await writeFile(join(overlay, "keep.txt"), "replacement");
  await writeFile(join(overlay, "added.txt"), "new");
  await writeFile(join(overlay, ".delete"), " remove.txt\r\n\nmissing.txt\n");
  await applyProblemOverlay(overlay, workspace);
  assert.deepEqual((await readdir(workspace)).sort(), ["added.txt", "keep.txt", "nested"]);
  assert.equal(await readFile(join(workspace, "keep.txt"), "utf8"), "replacement");
  assert.equal(await readFile(join(workspace, "nested", ".delete"), "utf8"), "ordinary nested data");
  assert.equal(await readFile(join(overlay, ".delete"), "utf8"), " remove.txt\r\n\nmissing.txt\n");
  // Repeat materialization is stable and does not mutate the source manifest.
  await applyProblemOverlay(overlay, workspace);
  assert.deepEqual((await readdir(workspace)).sort(), ["added.txt", "keep.txt", "nested"]);
});

test("missing overlay and missing control file are allowed", async (t) => {
  const { dir, overlay, workspace } = await fixture(t);
  await applyProblemOverlay(join(dir, "absent"), workspace);
  await writeFile(join(overlay, "added.txt"), "new");
  await applyProblemOverlay(overlay, workspace);
  assert.equal(await readFile(join(workspace, "added.txt"), "utf8"), "new");
  assert.equal(await readFile(join(workspace, "remove.txt"), "utf8"), "remove");
});

for (const bad of ["../outside.txt", "nested/../../outside.txt", ".", "nested/..", "/tmp/outside", "bad\0path"]) {
  test(`unsafe deletion ${JSON.stringify(bad)} fails before any copy or deletion`, async (t) => {
    const { dir, overlay, workspace } = await fixture(t);
    await writeFile(join(overlay, ".delete"), `remove.txt\n${bad}\n`);
    await writeFile(join(overlay, "keep.txt"), "changed");
    await assert.rejects(applyProblemOverlay(overlay, workspace), /unsafe overlay/);
    assert.equal(await readFile(join(workspace, "remove.txt"), "utf8"), "remove");
    assert.equal(await readFile(join(workspace, "keep.txt"), "utf8"), "base");
    assert.equal(await readFile(join(dir, "outside.txt"), "utf8"), "untouched");
  });
}

test("deletion cannot traverse an existing symlink outside the workspace", async (t) => {
  const { dir, overlay, workspace } = await fixture(t);
  await symlink(dir, join(workspace, "escape"));
  await writeFile(join(overlay, ".delete"), "escape/outside.txt\n");
  await assert.rejects(applyProblemOverlay(overlay, workspace), /symbolic link/);
  assert.equal(await readFile(join(dir, "outside.txt"), "utf8"), "untouched");
});

test("overlay copy cannot write through a destination symlink", async (t) => {
  const { dir, overlay, workspace } = await fixture(t);
  await symlink(join(dir, "outside.txt"), join(workspace, "linked.txt"));
  await writeFile(join(overlay, "linked.txt"), "changed");
  await assert.rejects(applyProblemOverlay(overlay, workspace), /symbolic link/);
  assert.equal(await readFile(join(dir, "outside.txt"), "utf8"), "untouched");
});

test("control file symlinks and malformed control directories are rejected rather than ignored", async (t) => {
  const { dir, overlay, workspace } = await fixture(t);
  await symlink(join(dir, "outside.txt"), join(overlay, ".delete"));
  await assert.rejects(applyProblemOverlay(overlay, workspace), /regular file/);
  await rm(join(overlay, ".delete"));
  await mkdir(join(overlay, ".delete"));
  await assert.rejects(applyProblemOverlay(overlay, workspace), /regular file/);
});

test("symlink overlays, copy sources and workspace roots are rejected", async (t) => {
  const { dir, overlay, workspace } = await fixture(t);
  await symlink(overlay, join(dir, "linked-overlay"));
  await assert.rejects(applyProblemOverlay(join(dir, "linked-overlay"), workspace), /directory/);
  await symlink(workspace, join(dir, "linked-workspace"));
  await assert.rejects(applyProblemOverlay(overlay, join(dir, "linked-workspace")), /symbolic link/);
  await symlink(join(dir, "outside.txt"), join(overlay, "link.txt"));
  await assert.rejects(applyProblemOverlay(overlay, workspace), /symbolic links/);
});


test("production build keeps the control file out of a materialized large problem", async (t) => {
  const { dir } = await fixture(t);
  const problems = join(dir, "problems");
  const problem = join(problems, "large-fixture");
  const codebase = join(problems, "_codebases", "fixture");
  await mkdir(codebase, { recursive: true });
  await mkdir(join(problem, "overlay"), { recursive: true });
  await writeFile(join(codebase, "keep.py"), "base");
  await writeFile(join(codebase, "remove.py"), "remove");
  await writeFile(join(problem, "task.json"), JSON.stringify({ size: "large", codebase: "fixture" }));
  await writeFile(join(problem, "overlay", ".delete"), "remove.py\n");
  await writeFile(join(problem, "overlay", "keep.py"), "overlay");
  const bin = join(dir, "bin");
  await mkdir(bin);
  // Stub only the pre-overlay Docker verification: no container/image/network operations.
  await writeFile(join(bin, "docker"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  const moduleURL = new URL("../src/problems/index.ts", import.meta.url).href;
  await promisify(execFile)(process.execPath, ["--import", "tsx", "--input-type=module", "-e",
    `import { buildProblems } from ${JSON.stringify(moduleURL)}; await buildProblems(["large-fixture"], ${JSON.stringify(problems)});`],
    { env: { ...process.env, PATH: `${bin}:${process.env.PATH ?? ""}` } });
  assert.deepEqual(await readdir(join(problem, "workspace")), ["keep.py"]);
  assert.equal(await readFile(join(problem, "workspace", "keep.py"), "utf8"), "overlay");
  assert.equal(await readFile(join(problem, "overlay", ".delete"), "utf8"), "remove.py\n");
  assert.equal(await readFile(join(problem, ".dockerignore"), "utf8"), "*\n!workspace/\n");
});
