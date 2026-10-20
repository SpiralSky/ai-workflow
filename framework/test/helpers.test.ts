import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBranch } from "../src/runner.js";
import { type Session } from "../src/helpers.js";

const problem = fileURLToPath(new URL("../../experiments/problems/01-chunk-off-by-one", import.meta.url));
const fresh = (): Session => {
  const cwd = mkdtempSync(join(tmpdir(), "helpers-test-"));
  cpSync(problem, cwd, { recursive: true });
  return { cwd, handles: new Map(), state: {} };
};

// --- edit() edge cases ---

test("edit: oldStr not found throws", async () => {
  const r = await runBranch(`await edit("chunks.py", "DOES_NOT_EXIST_XYZ", "replacement");`, fresh());
  assert.equal(r.kind, "error");
  assert.match(r.text, /found 0 times/);
});

test("edit: oldStr found more than once throws", async () => {
  // write a file with duplicate content, then try to edit the duplicate string
  const s = fresh();
  const r = await runBranch(
    `await writeFile("dup.py", "x = 1\\nx = 1\\n"); await edit("dup.py", "x = 1", "x = 2");`,
    s,
  );
  assert.equal(r.kind, "error");
  assert.match(r.text, /found 2 times/);
});

// --- writeFile() edge cases ---

test("writeFile: writing to an existing file throws", async () => {
  // chunks.py already exists in the workspace
  const r = await runBranch(`await writeFile("chunks.py", "content");`, fresh());
  assert.equal(r.kind, "error");
  assert.match(r.text, /exists; use edit/);
});

test("writeFile: new file succeeds", async () => {
  const r = await runBranch(`await writeFile("brand_new_file.py", "# new\\n"); return "ok";`, fresh());
  assert.equal(r.kind, "return");
  assert.equal(r.text, "ok");
});

// --- parallel() edge cases ---

test("parallel: one rejected promise rejects the whole call", async () => {
  // Promise.all rejects with the first failure; branch reports it as an error
  const r = await runBranch(
    `await parallel(Promise.resolve("ok"), Promise.reject(new Error("boom")));`,
    fresh(),
  );
  assert.equal(r.kind, "error");
  assert.match(r.text, /boom/);
});

test("parallel: all resolved returns all values", async () => {
  const r = await runBranch(
    `const [a, b] = await parallel(Promise.resolve(1), Promise.resolve(2)); return String(a + b);`,
    fresh(),
  );
  assert.equal(r.kind, "return");
  assert.equal(r.text, "3");
});

// --- bash() timeout ---

test("bash: times out and returns code -1", async () => {
  // 50ms timeout on a sleep-1 command
  const r = await runBranch(
    `const r = await bash("sleep 1", { timeoutMs: 50 }); return String(r.code);`,
    fresh(),
  );
  assert.equal(r.kind, "return");
  assert.equal(r.text, "-1");
});

test("bash: timeout message appears in output", async () => {
  const r = await runBranch(
    `const r = await bash("sleep 1", { timeoutMs: 50 }); return r.out;`,
    fresh(),
  );
  assert.equal(r.kind, "return");
  assert.match(r.text, /timed out/);
});
