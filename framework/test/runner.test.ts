import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBranch, defaultLimits } from "../src/runner.js";
import type { Session } from "../src/helpers.js";

const problem = fileURLToPath(new URL("../../loop-testbed/problems/01-chunk-off-by-one", import.meta.url));
const fresh = (): Session => {
  const cwd = mkdtempSync(join(tmpdir(), "branch-test-"));
  cpSync(problem, cwd, { recursive: true });
  return { cwd, handles: new Map(), state: {} };
};

test("plain return + path summary", async () => {
  const r = await runBranch(`const t = await readFile("chunks.py"); return t.length;`, fresh());
  assert.equal(r.kind, "return");
  assert.match(r.text, /^\d+$/);
  assert.equal(r.path, "[readFile]");
});

test("runtime error reports line N: src", async () => {
  const r = await runBranch(`const a = 1;\nconst b = 2;\nnull.foo();\nreturn a + b;`, fresh());
  assert.equal(r.kind, "error");
  assert.match(r.text, /\(line 3: null\.foo\(\);\)/);
});

test("TS type annotations accepted", async () => {
  const r = await runBranch(`const x: number = 2; function f(a: number): number { return a * 3; } return f(x) as number;`, fresh());
  assert.equal(r.kind, "return");
  assert.equal(r.text, "6");
});

test("returnUser ends with kind user", async () => {
  const r = await runBranch(`returnUser("hello");`, fresh());
  assert.equal(r.kind, "user");
  assert.equal(r.text, "hello");
});

test("returnUser inside try/catch still ends with user", async () => {
  const r = await runBranch(`try { returnUser("caught?"); } catch (e) { return "swallowed"; }`, fresh());
  assert.equal(r.kind, "user");
  assert.equal(r.text, "caught?");
});

test("edit fixes the bug; runTests false before, true after", async () => {
  const s = fresh();
  const before = await runBranch(`return (await runTests()).ok;`, s);
  assert.equal(before.text, "false");
  const r = await runBranch(
    `await edit("chunks.py", "range(0, len(items) - size + 1, size)", "range(0, len(items), size)"); return (await runTests()).ok;`, s);
  assert.equal(r.kind, "return");
  assert.equal(r.text, "true");
  assert.match(readFileSync(join(s.cwd, "chunks.py"), "utf8"), /range\(0, len\(items\), size\)/);
});

test("return > 4000 chars becomes a handle retrievable in a later run", async () => {
  const s = fresh();
  const r = await runBranch(`return "x".repeat(5000);`, s);
  assert.equal(r.kind, "return");
  assert.match(r.text, /handle \$h1/);
  assert.ok(r.text.length < 4300);
  const r2 = await runBranch(`return getHandle("$h1").length;`, s);
  assert.equal(r2.text, "5000");
});

test("maxCalls limit error", async () => {
  const r = await runBranch(`for (let i = 0; i < 10; i++) await bash("true"); return 1;`, fresh(), { ...defaultLimits, maxCalls: 3 });
  assert.equal(r.kind, "error");
  assert.match(r.text, /limit: more than 3 helper calls/);
});

test("path outside cwd rejected", async () => {
  const r = await runBranch(`return await readFile("../../etc/passwd");`, fresh());
  assert.equal(r.kind, "error");
  assert.match(r.text, /path outside workspace/);
});

test("state persists across runs", async () => {
  const s = fresh();
  await runBranch(`state.n = 41;`, s);
  const r = await runBranch(`return state.n + 1;`, s);
  assert.equal(r.text, "42");
});

test("intent is recorded in the branch trace", async () => {
  const s = fresh();
  s.traceFile = join(s.cwd, "trace.jsonl");
  await runBranch(`return 1;`, s, defaultLimits, "just a test");
  const ev = readFileSync(s.traceFile, "utf8").trim().split("\n").map((l) => JSON.parse(l)).find((e) => e.type === "branch");
  assert.equal(ev.intent, "just a test");
});
