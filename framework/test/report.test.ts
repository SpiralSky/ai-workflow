import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { lineDiff, snapshot, diffSnapshots, formatAuto } from "../src/report.js";

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
    assert.deepEqual([...s1.keys()].sort(), ["chunk.py", "gone.py"]);
    assert.equal(formatAuto(diffSnapshots(s1, snapshot(d))), "No file changes.");
    writeFileSync(join(d, "chunk.py"), "x = 1\ny = 3\n");
    rmSync(join(d, "gone.py"));
    mkdirSync(join(d, "sub")); writeFileSync(join(d, "sub", "new.py"), "1\n2\n3\n");
    const ch = diffSnapshots(s1, snapshot(d));
    assert.equal(formatAuto(ch, true), "Changes: chunk.py (+1 −1), gone.py (+0 −1), sub/new.py (+3 −0) · tests: ok");
    assert.equal(formatAuto(ch.slice(0, 1), false), "Changes: chunk.py (+1 −1) · tests: fail");
    assert.equal(formatAuto(ch.slice(0, 1)), "Changes: chunk.py (+1 −1)");
  } finally { rmSync(d, { recursive: true, force: true }); }
});
