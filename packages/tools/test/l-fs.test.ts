import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { before, test } from "node:test";
import { deleteFile, listDir, moveFile, multiEdit, type ToolCtx } from "../src/index.ts";

let root: string;
const ctx = (): ToolCtx => ({ root, signal: new AbortController().signal });
const read = (p: string) => readFileSync(join(root, p), "utf8");

before(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), "aiw-lfs-")));
  const outside = realpathSync(mkdtempSync(join(tmpdir(), "aiw-lfs-out-")));
  symlinkSync(outside, join(root, "link"));
});

test("multiEdit: several files, sequential edits on one file, one summary", async () => {
  writeFileSync(join(root, "a.txt"), "alpha\nbeta\n");
  writeFileSync(join(root, "b.txt"), "x = 1\nx = 1\n");
  const r: any = await multiEdit.fn({ edits: [
    { path: "a.txt", old: "alpha", new: "ALPHA" },
    { path: "a.txt", old: "ALPHA\nbeta", new: "$& done" }, // sees the previous edit's result
    { path: "b.txt", old: "x = 1", new: "x = 2", all: true },
  ] }, ctx());
  assert.equal(read("a.txt"), "$& done\n");
  assert.equal(read("b.txt"), "x = 2\nx = 2\n");
  assert.deepEqual(r.files.map((f: any) => f.path), ["a.txt", "b.txt"]);
  assert.deepEqual(r.files[1], { path: "b.txt", added: 2, removed: 2 });
  assert.ok(r.diff.includes("+x = 2"));
});

test("multiEdit: atomic when a later edit fails", async () => {
  writeFileSync(join(root, "c.txt"), "one\ntwo\n");
  writeFileSync(join(root, "d.txt"), "same\nsame\n");
  const bad: any[][] = [
    [{ path: "c.txt", old: "one", new: "1" }, { path: "c.txt", old: "zzz", new: "y" }],
    [{ path: "c.txt", old: "one", new: "1" }, { path: "d.txt", old: "same", new: "s" }],
    [{ path: "c.txt", old: "one", new: "1" }, { path: "missing.txt", old: "a", new: "b" }],
    [{ path: "c.txt", old: "one", new: "1" }, { path: "link/x.txt", old: "a", new: "b" }],
    [{ path: "c.txt", old: "", new: "1" }],
  ];
  const want = [/edit 2 \(c\.txt\): not found/, /edit 2 \(d\.txt\): not unique \(2 matches\)/, /edit 2 \(missing\.txt\): no such file/, /path outside workspace/, /edit 1 \(c\.txt\): old must not be empty/];
  for (const [i, edits] of bad.entries()) await assert.rejects(multiEdit.fn({ edits }, ctx()), want[i]);
  assert.equal(read("c.txt"), "one\ntwo\n");
  assert.equal(read("d.txt"), "same\nsame\n");
  await assert.rejects(multiEdit.fn({ edits: [] }, ctx()), /must not be empty/);
});

test("moveFile: moves, creates dirs, refuses overwrite, summary", async () => {
  writeFileSync(join(root, "m1.txt"), "l1\nl2\nl3\n");
  const r: any = await moveFile.fn({ from: "m1.txt", to: "sub/dir/m2.txt" }, ctx());
  assert.equal(existsSync(join(root, "m1.txt")), false);
  assert.equal(read("sub/dir/m2.txt"), "l1\nl2\nl3\n");
  assert.deepEqual(r.files, [{ path: "m1.txt", added: 0, removed: 3 }, { path: "sub/dir/m2.txt", added: 3, removed: 0 }]);

  writeFileSync(join(root, "m3.txt"), "other\n");
  await assert.rejects(moveFile.fn({ from: "m3.txt", to: "sub/dir/m2.txt" }, ctx()), /target exists: sub\/dir\/m2\.txt; pass overwrite: true/);
  assert.equal(read("sub/dir/m2.txt"), "l1\nl2\nl3\n");
  assert.ok(existsSync(join(root, "m3.txt")));
  const r2: any = await moveFile.fn({ from: "m3.txt", to: "sub/dir/m2.txt", overwrite: true }, ctx());
  assert.equal(read("sub/dir/m2.txt"), "other\n");
  assert.deepEqual(r2.files[1], { path: "sub/dir/m2.txt", added: 1, removed: 3 });

  await assert.rejects(moveFile.fn({ from: "nope.txt", to: "x.txt" }, ctx()), /no such file/);
  await assert.rejects(moveFile.fn({ from: "sub", to: "x.txt" }, ctx()), /not a file/);
  await assert.rejects(moveFile.fn({ from: "sub/dir/m2.txt", to: "link/out.txt" }, ctx()), /path outside workspace/);
});

test("deleteFile: removes, counts lines, rejects dirs and missing", async () => {
  writeFileSync(join(root, "del.txt"), "a\nb\n");
  const r: any = await deleteFile.fn({ path: "del.txt" }, ctx());
  assert.equal(existsSync(join(root, "del.txt")), false);
  assert.deepEqual(r.files, [{ path: "del.txt", added: 0, removed: 2 }]);
  assert.ok(r.diff.includes("-a"));
  await assert.rejects(deleteFile.fn({ path: "del.txt" }, ctx()), /no such file/);
  await assert.rejects(deleteFile.fn({ path: "sub" }, ctx()), /not a file/);
  await assert.rejects(deleteFile.fn({ path: "../x" }, ctx()), /path outside workspace/);
});

test("listDir: depth, sizes, skips, truncation", async () => {
  const lr = realpathSync(mkdtempSync(join(tmpdir(), "aiw-ld-")));
  const c = { root: lr, signal: new AbortController().signal };
  mkdirSync(join(lr, "src/deep/er"), { recursive: true });
  mkdirSync(join(lr, "node_modules/m"), { recursive: true });
  mkdirSync(join(lr, ".git"));
  writeFileSync(join(lr, "top.txt"), "12345");
  writeFileSync(join(lr, "src/a.py"), "abc");
  writeFileSync(join(lr, "src/deep/b.py"), "12");
  writeFileSync(join(lr, "src/deep/er/c.py"), "1");
  writeFileSync(join(lr, "node_modules/m/x.js"), "zzzzzzzz");
  writeFileSync(join(lr, ".git/config"), "zzzz");
  const d2: any = await listDir.fn({}, c);
  assert.deepEqual(d2.entries, [
    { path: "src", type: "dir", size: 6 },
    { path: "src/a.py", type: "file", size: 3 },
    { path: "src/deep", type: "dir", size: 3 },
    { path: "top.txt", type: "file", size: 5 },
  ]);
  const d1: any = await listDir.fn({ depth: 1 }, c);
  assert.deepEqual(d1.entries.map((e: any) => e.path), ["src", "top.txt"]);
  const sub: any = await listDir.fn({ path: "src", depth: 3 }, c);
  assert.deepEqual(sub.entries.map((e: any) => e.path), ["src/a.py", "src/deep", "src/deep/b.py", "src/deep/er", "src/deep/er/c.py"]);
  await assert.rejects(listDir.fn({ path: "top.txt" }, c), /not a directory/);
  await assert.rejects(listDir.fn({ path: "nope" }, c), /no such directory/);
  await assert.rejects(listDir.fn({ depth: 0 }, c), /invalid depth/);
  for (let i = 0; i < 300; i++) writeFileSync(join(lr, `f${String(i).padStart(3, "0")}.txt`), "x");
  const big: any = await listDir.fn({}, c);
  assert.ok(big.entries.length <= 200 && /^showing \d+ of \d+; pass a subdirectory/.test(big.truncated));
});
