import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative } from "node:path";
import { test } from "node:test";
import { catalog, history, makeDiff, makeRestore, takeSnapshot, type ToolCtx } from "../src/index.ts";

const mk = (p: string) => realpathSync(mkdtempSync(join(tmpdir(), p)));
const put = (root: string, rel: string, text: string) => {
  mkdirSync(dirname(join(root, rel)), { recursive: true });
  writeFileSync(join(root, rel), text);
};
const ctxOf = (root: string): ToolCtx => ({ root, signal: new AbortController().signal });
const git = (root: string, ...a: string[]) => {
  const r = spawnSync("git", ["-c", "user.name=T", "-c", "user.email=t@example.com", ...a], { cwd: root, encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
};

test("snapshot: outside root, excludes .git and node_modules, lists and reads pristine files, disposes", async () => {
  const root = mk("aiw-snap-");
  put(root, "a.txt", "A");
  put(root, "d/b.txt", "B");
  put(root, "node_modules/m/x.js", "x");
  put(root, ".git/config", "c");
  const snap = await takeSnapshot(root);
  assert.ok(relative(root, snap.archive).startsWith(".."), "archive is outside the workspace");
  assert.ok(existsSync(snap.archive));
  put(root, "a.txt", "changed");
  assert.deepEqual(await snap.list(), ["a.txt", "d/b.txt"]);
  assert.equal((await snap.read("a.txt"))!.toString(), "A");
  assert.equal(await snap.read("nope.txt"), null);
  await assert.rejects(snap.read("../x"), /path outside workspace/);
  snap.dispose();
  assert.equal(existsSync(snap.archive), false);
});

test("diff and restore: no snapshot throws", async () => {
  const root = mk("aiw-vcs0-");
  const [d, r] = [makeDiff(), makeRestore()];
  await assert.rejects(d.fn({}, ctxOf(root)), /no snapshot/);
  await assert.rejects(r.fn({ path: "a" }, ctxOf(root)), /no snapshot/);
  const tools = catalog("L", { root });
  await assert.rejects(tools.find((t) => t.name === "diff")!.fn({}, ctxOf(root)), /no snapshot/);
});

test("diff and restore work without .git", async () => {
  const root = mk("aiw-vcs1-");
  put(root, "keep.txt", "same\n");
  put(root, "mod.py", "a\nb\nc\n");
  put(root, "gone.txt", "bye\n");
  put(root, "pkg/x.py", "x = 1\n");
  put(root, "pkg/y.py", "y = 1\n");
  writeFileSync(join(root, "bin.dat"), Buffer.from([1, 0, 2]));
  chmodSync(join(root, "mod.py"), 0o755);
  const snap = await takeSnapshot(root);
  const diff = makeDiff(snap), restore = makeRestore(snap);
  const c = ctxOf(root);
  try {
    const clean: any = await diff.fn({}, c);
    assert.deepEqual(clean, { status: [], diff: "" });

    put(root, "mod.py", "a\nB\nc\n");
    rmSync(join(root, "gone.txt"));
    put(root, "new/dir/n.txt", "n1\nn2\n");
    put(root, "pkg/x.py", "x = 2\n");
    writeFileSync(join(root, "bin.dat"), Buffer.from([9, 0, 2]));
    put(root, "node_modules/z/q.js", "ignored");

    const d: any = await diff.fn({}, c);
    assert.deepEqual(d.status, [
      { path: "bin.dat", change: "modified" },
      { path: "gone.txt", change: "deleted" },
      { path: "mod.py", change: "modified" },
      { path: "new/dir/n.txt", change: "added" },
      { path: "pkg/x.py", change: "modified" },
    ]);
    assert.ok(d.diff.includes("-b\n+B"));
    assert.ok(d.diff.includes("Binary files a/bin.dat and b/bin.dat differ"));
    assert.ok(d.diff.includes("+n1"));
    assert.ok(d.diff.includes("-bye"));
    const one: any = await diff.fn({ path: "pkg" }, c);
    assert.deepEqual(one.status, [{ path: "pkg/x.py", change: "modified" }]);
    await assert.rejects(diff.fn({ path: "../x" }, c), /path outside workspace/);

    // restore one file
    const r1: any = await restore.fn({ path: "mod.py" }, c);
    assert.equal(readFileSync(join(root, "mod.py"), "utf8"), "a\nb\nc\n");
    assert.equal(statSync(join(root, "mod.py")).mode & 0o777, 0o755);
    assert.deepEqual(r1.files, [{ path: "mod.py", added: 1, removed: 1 }]);
    // restore a deleted file
    await restore.fn({ path: "gone.txt" }, c);
    assert.equal(readFileSync(join(root, "gone.txt"), "utf8"), "bye\n");
    // added files are kept by default
    assert.deepEqual(((await restore.fn({ path: "new" }, c)) as any).files, []);
    assert.equal(existsSync(join(root, "new/dir/n.txt")), true);
    // deleteAdded removes them, and emptied dirs go too
    const r3: any = await restore.fn({ path: "new", deleteAdded: true }, c);
    assert.deepEqual(r3.files, [{ path: "new/dir/n.txt", added: 0, removed: 2 }]);
    assert.equal(existsSync(join(root, "new")), false);
    // restore the whole tree
    put(root, "extra.txt", "e\n");
    await restore.fn({ path: "." }, c);
    assert.equal(existsSync(join(root, "extra.txt")), true);
    await restore.fn({ path: ".", deleteAdded: true }, c);
    assert.deepEqual(await diff.fn({}, c), { status: [], diff: "" });
    assert.equal(existsSync(join(root, "extra.txt")), false);
    assert.equal(readFileSync(join(root, "pkg/x.py"), "utf8"), "x = 1\n");
    assert.equal(existsSync(join(root, "node_modules/z/q.js")), true, "ignored dirs untouched");
    // already pristine: empty summary
    assert.deepEqual(((await restore.fn({ path: "keep.txt" }, c)) as any).files, []);
  } finally {
    snap.dispose();
  }
});

test("diff: large diff is cut with a hint", async () => {
  const root = mk("aiw-vcs2-");
  put(root, "big.txt", "a\n");
  const snap = await takeSnapshot(root);
  try {
    put(root, "big.txt", Array.from({ length: 3000 }, (_, i) => `line ${i}`).join("\n") + "\n");
    const d: any = await makeDiff(snap).fn({}, ctxOf(root));
    assert.ok(Buffer.byteLength(d.diff) <= 6000);
    assert.match(d.truncated, /diff cut at \d+ of \d+ bytes; pass path/);
    assert.deepEqual(d.status, [{ path: "big.txt", change: "modified" }]);
  } finally {
    snap.dispose();
  }
});

test("history: no repository throws no history", async () => {
  const root = mk("aiw-hist0-");
  put(root, "a.py", "x\n");
  await assert.rejects(history.fn({ path: "a.py" }, ctxOf(root)), /no history/);
});

test("history: git log, range blame, symbol log", async () => {
  const root = mk("aiw-hist1-");
  git(root, "init", "-q", "-b", "main");
  await assert.rejects(history.fn({ path: "a.py" }, ctxOf(root)), /no history/); // no commits yet
  put(root, "a.py", "def foo():\n    return 1\n\n\ndef bar():\n    return 2\n");
  git(root, "add", "."); git(root, "commit", "-q", "-m", "add foo and bar");
  put(root, "a.py", "def foo():\n    return 10\n\n\ndef bar():\n    return 2\n");
  git(root, "commit", "-qam", "change foo");
  put(root, "a.py", "def foo():\n    return 10\n\n\ndef bar():\n    return 20\n");
  git(root, "commit", "-qam", "change bar");
  const c = ctxOf(root);

  const log: any = await history.fn({ path: "a.py" }, c);
  assert.deepEqual(log.commits.map((x: any) => x.subject), ["change bar", "change foo", "add foo and bar"]);
  assert.equal(log.commits[0].author, "T");
  assert.equal(log.blame, undefined);

  const range: any = await history.fn({ path: "a.py", range: [1, 2] }, c);
  assert.deepEqual(range.commits.map((x: any) => x.subject), ["change foo", "add foo and bar"]);
  assert.equal(range.blame.length, 2);
  assert.deepEqual(range.blame.map((b: any) => b.text), ["def foo():", "    return 10"]);
  assert.equal(range.blame[1].author, "T");

  const sym: any = await history.fn({ path: "a.py", symbol: "a.py#bar" }, c);
  assert.deepEqual(sym.commits.map((x: any) => x.subject), ["change bar", "add foo and bar"]);

  await assert.rejects(history.fn({ path: "a.py", range: [5, 2] }, c), /invalid range/);
  await assert.rejects(history.fn({ path: "a.py", symbol: "x; rm" }, c), /invalid symbol/);
  await assert.rejects(history.fn({ path: "missing.py" }, c), /no commits touch missing\.py/);
  await assert.rejects(history.fn({ path: "../x" }, c), /path outside workspace/);
});
