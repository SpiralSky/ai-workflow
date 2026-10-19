import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lineDiff, snapshot, diffSnapshots, formatAuto, saveSnapshot, takeReport } from "../src/report.js";

test("lineDiff", () => {
  assert.deepEqual(lineDiff("a\nb\nc\n", "a\nb\nc\n"), { added: 0, deleted: 0 });
  assert.deepEqual(lineDiff("a\nb\nc\n", "a\nX\nc\n"), { added: 1, deleted: 1 });
  assert.deepEqual(lineDiff("", "a\nb\n"), { added: 2, deleted: 0 });
  assert.deepEqual(lineDiff("a\nb\n", ""), { added: 0, deleted: 2 });
  assert.deepEqual(lineDiff("a\nb\nc\nd\n", "b\nc\nd\ne\nf\n"), { added: 2, deleted: 1 });
});

test("snapshot/diff/format", () => {
  const d = mkdtempSync(join(tmpdir(), "rep-"));
  try {
    writeFileSync(join(d, "chunk.py"), "x = 1\ny = 2\n");
    writeFileSync(join(d, "gone.py"), "a\n");
    mkdirSync(join(d, "node_modules")); writeFileSync(join(d, "node_modules", "z.js"), "z");
    mkdirSync(join(d, "__pycache__")); writeFileSync(join(d, "__pycache__", "c.pyc"), "z");
    writeFileSync(join(d, "big.txt"), "x".repeat(300 * 1024));
    const s1 = snapshot(d);
    assert.deepEqual([...s1.keys()].sort(), ["big.txt", "chunk.py", "gone.py"]); // big.txt: opaque sentinel
    assert.equal(formatAuto(diffSnapshots(s1, snapshot(d))), "No file changes.");
    assert.ok(!s1.get("big.txt")!.includes("xxx")); // no content kept
    writeFileSync(join(d, "chunk.py"), "x = 1\ny = 3\n");
    rmSync(join(d, "gone.py"));
    mkdirSync(join(d, "sub")); writeFileSync(join(d, "sub", "new.py"), "1\n2\n3\n");
    const ch = diffSnapshots(s1, snapshot(d));
    assert.equal(formatAuto(ch, true), "Changes: chunk.py (+1 −1), gone.py (+0 −1), sub/new.py (+3 −0) · tests: ok");
    assert.equal(formatAuto(ch.slice(0, 1), false), "Changes: chunk.py (+1 −1) · tests: fail");
    assert.equal(formatAuto(ch.slice(0, 1)), "Changes: chunk.py (+1 −1)");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

function withTrace<T>(f: (d: string) => T): T {
  const td = mkdtempSync(join(tmpdir(), "td-")), old = process.env.BRANCH_TRACE_DIR;
  process.env.BRANCH_TRACE_DIR = td;
  try { return f(td); } finally {
    if (old === undefined) delete process.env.BRANCH_TRACE_DIR; else process.env.BRANCH_TRACE_DIR = old;
    rmSync(td, { recursive: true, force: true });
  }
}

test("file names with spaces; binary and large changes; skipped dirs", () => {
  const d = mkdtempSync(join(tmpdir(), "rep-"));
  try {
    writeFileSync(join(d, "my file.py"), "a\n");
    writeFileSync(join(d, "bin.dat"), Buffer.from([0, 1, 2]));
    mkdirSync(join(d, ".venv")); writeFileSync(join(d, ".venv", "x.py"), "z");
    mkdirSync(join(d, "dist")); writeFileSync(join(d, "dist", "x.js"), "z");
    const s1 = snapshot(d);
    assert.deepEqual([...s1.keys()], ["bin.dat", "my file.py"]);
    writeFileSync(join(d, "my file.py"), "a\nb\n");
    writeFileSync(join(d, "bin.dat"), Buffer.from([0, 1, 3]));
    assert.equal(formatAuto(diffSnapshots(s1, snapshot(d))), "Changes: bin.dat (modified, binary/large), my file.py (+1 −0)");
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("git repo: uses ls-files (respects .gitignore, spaces)", () => {
  const d = mkdtempSync(join(tmpdir(), "rep-"));
  try {
    if (spawnSync("git", ["init", "-q"], { cwd: d }).status !== 0) return;
    writeFileSync(join(d, ".gitignore"), "ignored.txt\n");
    writeFileSync(join(d, "ignored.txt"), "x"); writeFileSync(join(d, "a b.py"), "1\n");
    assert.deepEqual([...snapshot(d).keys()].sort(), [".gitignore", "a b.py"]);
  } finally { rmSync(d, { recursive: true, force: true }); }
});

test("takeReport diffs the saved cwd even if the hook cwd changed mid-turn", () => {
  withTrace(() => {
    const d = mkdtempSync(join(tmpdir(), "rep-"));
    try {
      mkdirSync(join(d, "sub")); writeFileSync(join(d, "a.py"), "1\n"); writeFileSync(join(d, "sub", "b.py"), "1\n");
      saveSnapshot("s", d);
      writeFileSync(join(d, "a.py"), "2\n");
      assert.equal(takeReport("s", join(d, "sub")), "Changes: a.py (+1 −1)");
      assert.equal(takeReport("s", d, true), undefined); // consumed
    } finally { rmSync(d, { recursive: true, force: true }); }
  });
});
