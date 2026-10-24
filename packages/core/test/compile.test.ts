import test from "node:test";
import assert from "node:assert/strict";
import { compileBranch } from "../src/branch/compile.ts";
import type { CompiledBranch } from "../src/branch/types.ts";

/** Compiles `src`, runs it against a recording fake `__t`, returns calls, result and the compiled output. */
async function run(src: string, tools: Record<string, any> = {}, state: any = {}) {
  const c = compileBranch(src);
  assert.ok(!("error" in c), "error" in c ? c.message : "");
  const calls: any[][] = [];
  const rec = (name: string) => (...a: any[]) => (calls.push([name, ...a]), a);
  const __t = {
    cond: (...a: any[]) => (calls.push(["cond", ...a]), a[2]),
    case: rec("case"),
    loopEnter: rec("enter"),
    loopIter: rec("iter"),
    loopExit: rec("exit"),
    ret: (l: number, v: unknown) => (calls.push(["ret", l, v]), v),
  };
  const fn = new Function("__t", "return " + c.js)(__t);
  let value: unknown, thrown: unknown;
  try {
    value = await fn(tools, state);
  } catch (e) {
    thrown = e;
  }
  return { calls, value, thrown, c: c as CompiledBranch };
}
const names = (calls: any[][]) => calls.map((c) => c[0]).join(",");

test("accepts block and expression bodied async arrows", () => {
  assert.ok("js" in compileBranch("async (tools, state) => { return 1; }"));
  assert.ok("js" in compileBranch("async (tools) => tools.x()"));
  assert.ok("js" in compileBranch("async () => { return 1; };\n"));
});

test("rejects non-async arrow, function keyword and other roots", () => {
  for (const s of ["(tools) => 1", "async function f() {}", "function () {}", "42"]) {
    const r = compileBranch(s) as any;
    assert.equal(r.error, "compile", s);
    assert.match(r.message, /async arrow function/);
  }
});

test("rejects import, import(), import.meta and require with a line", () => {
  const cases = [
    'async () => {\n  const m = await import("fs");\n}',
    'async () => {\n\n  const fs = require("fs");\n}',
    "async () => {\n  return import.meta.url;\n}",
    'async () => {\n  import x from "y";\n}',
  ];
  const lines = [2, 3, 2, 2];
  cases.forEach((s, i) => {
    const r = compileBranch(s) as any;
    assert.equal(r.error, "compile");
    assert.equal(r.line, lines[i], s);
    assert.match(r.message, /only external interface is `tools`/);
  });
});

test("syntax error reports the original 1-based line", () => {
  const r = compileBranch("async () => {\n  const x = ;\n}") as any;
  assert.equal(r.error, "compile");
  assert.equal(r.line, 2);
});

test("if / else if report values and condition offsets", async () => {
  const src = "async (t, s) => {\n  if (s.a) {\n    return 1;\n  } else if (s.b > 1) {\n    return 2;\n  }\n  return 3;\n}";
  const r = await run(src, {}, { a: 0, b: 2 });
  assert.equal(r.value, 2);
  const conds = r.calls.filter((c) => c[0] === "cond");
  assert.deepEqual(conds.map((c) => [c[1], c[2], c[3]]), [[2, "if", 0], [4, "if", true]]);
  const [, , , , pos, end] = conds[1];
  assert.equal(src.slice(pos, end), "s.b > 1");
  assert.deepEqual(r.calls.filter((c) => c[0] === "ret"), [["ret", 5, 2]]);
});

test("ternary, including an if inside a ternary arm and nested ternaries", async () => {
  const r = await run("async (t, s) => { return s.x ? (s.y ? 'a' : 'b') : 'c'; }", {}, { x: 1, y: 0 });
  assert.equal(r.value, "b");
  assert.deepEqual(r.calls.filter((c) => c[0] === "cond").map((c) => [c[2], c[3]]), [["ternary", 1], ["ternary", 0]]);
  const r2 = await run("async () => { const f = (v) => v ? (() => { if (v > 1) return 'big'; return 'small'; })() : 'none'; return f(2); }");
  assert.equal(r2.value, "big");
  assert.deepEqual(r2.calls.filter((c) => c[0] === "cond").map((c) => c[2]), ["ternary", "if"]);
});

test("switch records the taken clause and evaluates case expressions once", async () => {
  let n = 0;
  const src = "async (t) => {\n  switch (2) {\n    case t.f(1): break;\n    case t.f(2):\n      break;\n    default: break;\n  }\n}";
  const r = await run(src, { f: (v: number) => (n++, v) });
  assert.equal(n, 2);
  assert.equal(names(r.calls), "case");
  const [, line, pos, end] = r.calls[0];
  assert.equal(line, 4);
  assert.match(src.slice(pos, end), /^case t\.f\(2\):\s+break;$/);
});

test("switch default and fall-through", async () => {
  const r = await run("async () => { switch (9) { case 1: case 2: break; default: return 'd'; } }");
  assert.equal(r.value, "d");
  assert.equal(names(r.calls), "case,ret");
});

test("catch records after the block opens", async () => {
  const r = await run("async () => {\n  try { throw new Error('x'); }\n  catch (e) { return e.message; }\n}");
  assert.equal(r.value, "x");
  assert.deepEqual(r.calls[0].slice(0, 4), ["cond", 3, "catch", true]);
});

test("loops: enter/iter/exit counts, break, kinds and endLine", async () => {
  const src = "async (t, s) => {\n  for (let i = 0; i < 5; i++) {\n    if (i == 2) break;\n  }\n  for (const x of [1,2]) s.n = x;\n  let k = 0; while (k < 3) k++;\n  do { k--; } while (k > 2);\n  for (const p in {a: 1}) {}\n}";
  const r = await run(src);
  const loops = r.calls.filter((c) => ["enter", "iter", "exit"].includes(c[0]));
  const enters = loops.filter((c) => c[0] === "enter");
  assert.deepEqual(enters.map((c) => [c[1], c[2], c[3]]), [[2, "for", 4], [5, "for-of", 5], [6, "while", 6], [7, "do", 7], [8, "for-in", 8]]);
  assert.equal(loops.filter((c) => c[0] === "iter" && c[1] === 2).length, 3);
  assert.equal(loops.filter((c) => c[0] === "iter" && c[1] === 5).length, 2);
  assert.equal(loops.filter((c) => c[0] === "exit").length, 5);
  assert.equal((r.thrown as any)?.message, undefined);
});

test("nested loops with non-block bodies and labelled continue", async () => {
  const src = "async () => {\n  outer: for (const a of [1,2]) for (const b of [1,2]) { if (b == 1) continue outer; }\n}";
  const r = await run(src);
  assert.equal(r.thrown, undefined);
  assert.equal(names(r.calls.filter((c) => c[0] !== "cond")), "enter,iter,enter,iter,exit,iter,enter,iter,exit,exit");
});

test("throw out of a loop still records exit", async () => {
  const r = await run("async () => { while (true) { throw new Error('boom'); } }");
  assert.equal((r.thrown as Error).message, "boom");
  assert.equal(names(r.calls), "enter,iter,exit");
});

test("only root returns are recorded", async () => {
  const src = "async (t) => {\n  const f = (x) => { return x + 1; };\n  const o = { m() { return 5; } };\n  class C { g() { return 6; } }\n  [1].map(function (v) { return v; });\n  return f(1) + o.m();\n}";
  const r = await run(src);
  assert.equal(r.value, 7);
  assert.deepEqual(r.calls.filter((c) => c[0] === "ret"), [["ret", 6, 7]]);
});

test("bare return and expression body return", async () => {
  const a = await run("async () => { if (1) return; return 2; }");
  assert.deepEqual(a.calls.filter((c) => c[0] === "ret"), [["ret", 1, undefined]]);
  const b = await run("async () => ({ a: 1 })");
  assert.deepEqual(b.calls, [["ret", 1, { a: 1 }]]);
});

test("nested callbacks still get cond and loop instrumentation", async () => {
  const r = await run("async () => { [1, 2].forEach((v) => { if (v > 1) { for (;;) break; } }); }");
  assert.equal(names(r.calls), "cond,cond,enter,iter,exit");
});

test("types are stripped and lines map back to the original", async () => {
  const src = [
    "async (tools: Tools, state: any) => {",
    "  interface Foo { a: number }",
    "  type Bar = Foo[];",
    "  const x = (state.v as number) + 1;",
    "  const id = <T,>(v: T): T => v;",
    "  const o = {",
    "    a: 1,",
    "    b: 2,",
    "  };",
    "  if (x > 1) {",
    "    return id<number>(x);",
    "  }",
    "}",
  ].join("\n");
  const r = await run(src, {}, { v: 1 });
  assert.equal(r.value, 2);
  assert.ok(!/interface|\bas\b/.test(r.c.js));
  const jsLines = r.c.js.split("\n");
  assert.equal(r.c.lineMap.length, jsLines.length);
  const find = (needle: string) => r.c.lineMap[jsLines.findIndex((l) => l.includes(needle))];
  assert.equal(find("const x"), 4);
  assert.equal(find("const id"), 5);
  assert.equal(find('"if"'), 10);
  assert.equal(find("__t.ret"), 11);
});
