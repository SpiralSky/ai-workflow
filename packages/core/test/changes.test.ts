import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, unlink, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ChangeTracker, diffSnapshots, gitignoreMatcher, snapshotWorkspace } from "../src/orchestrate/index.ts";

/** Writes `files` (path → content) under `root`. */
async function put(root: string, files: Record<string, string>) {
  for (const [p, c] of Object.entries(files)) {
    await mkdir(join(root, p, ".."), { recursive: true });
    await writeFile(join(root, p), c);
  }
}

test("gitignore matcher: names, dirs, globs, anchoring", () => {
  const m = gitignoreMatcher("# c\nbuild/\n*.log\n/top.txt\ndocs/gen\n!keep.log\n");
  assert.ok(m("build", true) && !m("build", false));
  assert.ok(m("a/b/x.log", false));
  assert.ok(m("top.txt", false) && !m("sub/top.txt", false));
  assert.ok(m("docs/gen", false) && !m("x/docs/gen", false));
  assert.ok(m("keep.log", false)); // negation unsupported: still ignored by *.log
});

test("walk fallback: diff add/modify/delete, ignored dirs and .gitignore", async () => {
  const root = await mkdtemp(join(tmpdir(), "aiw-ch-"));
  try {
    await put(root, {
      ".gitignore": "*.log\nout/\n",
      "a.txt": "a",
      "src/b.txt": "b",
      "src/gone.txt": "g",
      "x.log": "l",
      "out/o.txt": "o",
      "node_modules/m/i.js": "m",
      ".git/HEAD": "h",
      "pkg/__pycache__/c.pyc": "c",
      ".venv/v": "v",
      ".pytest_cache/p": "p",
    });
    const tracker = new ChangeTracker(root);
    await tracker.begin();
    await put(root, { "a.txt": "A!", "new/n.txt": "n", "x.log": "ll", "out/o2.txt": "o", "node_modules/m/j.js": "m", ".git/X": "x", "pkg/__pycache__/d.pyc": "d" });
    await unlink(join(root, "src/gone.txt"));
    const ch = await tracker.end();
    assert.deepEqual(ch, { added: ["new/n.txt"], modified: ["a.txt"], deleted: ["src/gone.txt"] });
    const snap = await snapshotWorkspace(root);
    assert.deepEqual([...snap.keys()], [".gitignore", "a.txt", "new/n.txt", "src/b.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("hash reuse when size and mtime unchanged; rehash on change", async () => {
  const root = await mkdtemp(join(tmpdir(), "aiw-ch-"));
  try {
    await put(root, { "f.txt": "one" });
    const t = new Date(2020, 1, 1);
    await utimes(join(root, "f.txt"), t, t);
    const s1 = await snapshotWorkspace(root);
    s1.get("f.txt")!.sha1 = "sentinel";
    assert.equal((await snapshotWorkspace(root, s1)).get("f.txt")!.sha1, "sentinel");
    await put(root, { "f.txt": "two" });
    await utimes(join(root, "f.txt"), t, t); // same mtime, same size → reuse (documented limit)
    assert.equal((await snapshotWorkspace(root, s1)).get("f.txt")!.sha1, "sentinel");
    await put(root, { "f.txt": "three" });
    const s3 = await snapshotWorkspace(root, s1);
    assert.notEqual(s3.get("f.txt")!.sha1, "sentinel");
    assert.deepEqual(diffSnapshots(s1, s3).modified, ["f.txt"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("git repo: uses git file list (honours nested ignore), reports changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "aiw-ch-"));
  try {
    const git = (...a: string[]) => execFileSync("git", ["-c", "user.name=t", "-c", "user.email=t@t", ...a], { cwd: root, stdio: "ignore" });
    await put(root, { "tracked.txt": "t", "sub/.gitignore": "secret\n", "sub/secret": "s", "sub/keep": "k" });
    git("init", "-q");
    git("add", ".");
    git("commit", "-qm", "init");
    const tracker = new ChangeTracker(root);
    await tracker.begin();
    await put(root, { "tracked.txt": "changed!", "untracked.txt": "u", "sub/secret": "s2" });
    const ch = await tracker.end();
    assert.deepEqual(ch, { added: ["untracked.txt"], modified: ["tracked.txt"], deleted: [] });
    const snap = await snapshotWorkspace(root);
    assert.ok(!snap.has("sub/secret") && snap.has("sub/keep") && !snap.has(".git/HEAD"));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
