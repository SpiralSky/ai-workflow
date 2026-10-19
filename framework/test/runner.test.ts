import { test } from "node:test";
import assert from "node:assert/strict";
import { cpSync, existsSync, mkdtempSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { runBranch, defaultLimits } from "../src/runner.js";
import { sh, extractSymbol, type Session } from "../src/helpers.js";

const problem = fileURLToPath(new URL("../../experiments/problems/01-chunk-off-by-one", import.meta.url));
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

test("bash timeout kills grandchildren fast", async () => {
  const t0 = Date.now();
  const r = await runBranch(`const r = await bash("sleep 5 | cat", { timeoutMs: 500 }); return r.code;`, fresh());
  assert.equal(r.text, "-1");
  assert.ok(Date.now() - t0 < 3000);
});

test("sh keeps the tail of capped output", async () => {
  const r = await sh(`head -c 300000 /dev/zero | tr '\\0' a; echo END`, tmpdir(), 10_000);
  assert.match(r.out, /^\[…truncated \d+ chars\]/);
  assert.match(r.out, /END\n$/);
});

test("async infinite loop times out and the runner stays usable", async () => {
  const s = fresh();
  const r = await runBranch(`await bash("true"); while (true) {}`, s, { ...defaultLimits, timeoutMs: 500 });
  assert.equal(r.kind, "error");
  assert.match(r.text, /timeout 500ms/);
  const r2 = await runBranch(`return 1 + 1;`, s);
  assert.equal(r2.text, "2");
});

test("program cannot act after timeout", async () => {
  const s = fresh();
  const r = await runBranch(`await new Promise(r => setTimeout(r, 50)); await bash("sleep 1"); await bash("touch late.txt"); return 1;`, s, { ...defaultLimits, timeoutMs: 300 }).catch(() => undefined);
  await new Promise((r) => setTimeout(r, 1500));
  assert.equal(existsSync(join(s.cwd, "late.txt")), false);
  assert.ok(r);
});

test("parallel calls cannot bypass maxCalls", async () => {
  const s = fresh();
  const r = await runBranch(`await parallel(...Array.from({length: 10}, () => bash("echo x >> n.txt"))); return 1;`, s, { ...defaultLimits, maxCalls: 3 });
  assert.equal(r.kind, "error");
  assert.match(r.text, /limit: more than 3/);
  await new Promise((r) => setTimeout(r, 300));
  assert.equal(readFileSync(join(s.cwd, "n.txt"), "utf8").trim().split("\n").length, 3);
});

test("unawaited rejection, circular and BigInt returns, state round-trip", async () => {
  const s = fresh();
  assert.equal((await runBranch(`readFile("nope.txt"); await bash("true"); return 1;`, s)).text, "1");
  const c = await runBranch(`const a: any = {}; a.a = a; return a;`, s);
  assert.equal(c.kind, "return");
  assert.equal((await runBranch(`return 10n;`, s)).text, "10");
  assert.equal((await runBranch(`state.k = [1]; return 1;`, s)).text, "1");
  assert.deepEqual(s.state.k, [1]);
});

test("path check: ..foo allowed, symlink escape rejected", async () => {
  const s = fresh();
  assert.equal((await runBranch(`await writeFile("..foo", "x"); return await readFile("..foo");`, s)).text, "x");
  symlinkSync("/etc", join(s.cwd, "lnk"));
  const r = await runBranch(`return await readFile("lnk/hostname");`, s);
  assert.match(r.text, /path outside workspace/);
});

test("extractSymbol: expression bodies, types, braces in strings", () => {
  const src = `const f = () => 1;\nconst g = 2;\ninterface A {\n  x: "}";\n}\ntype T = "a" | "b";\nconst z = 3;\nfunction h() {\n  // }\n  return "{";\n}\nlet q;\n`;
  assert.equal(extractSymbol(src, "f", ".ts"), "const f = () => 1;");
  assert.equal(extractSymbol(src, "A", ".ts"), `interface A {\n  x: "}";\n}`);
  assert.equal(extractSymbol(src, "T", ".ts"), `type T = "a" | "b";`);
  assert.equal(extractSymbol(src, "h", ".ts"), `function h() {\n  // }\n  return "{";\n}`);
});
