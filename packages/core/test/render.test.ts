import assert from "node:assert/strict";
import { test } from "node:test";
import { compact } from "../src/branch/limits.ts";
import { renderFooter } from "../src/branch/footer.ts";
import { renderTrace } from "../src/branch/render/index.ts";
import type { BranchResult, TraceEvent } from "../src/branch/types.ts";

const start = (id: number, line: number, name: string, args: unknown, t = 0): TraceEvent =>
  ({ type: "call", phase: "start", id, line, name, args, t });
const end = (id: number, t: number, ms: number, result: unknown): TraceEvent =>
  ({ type: "call", phase: "end", id, ok: true, t, ms, result });
const fail = (id: number, t: number, error: string): TraceEvent =>
  ({ type: "call", phase: "end", id, ok: false, t, ms: 1, error });
const ok = (trace: TraceEvent[], value: unknown = null): BranchResult => ({ ok: true, value, trace });
const render = (r: BranchResult, source = "", mode: "trace" | "annotated" | "full" = "trace") =>
  renderTrace(r, { mode, source });

const SRC = [
  "const r = await tools.bash({cmd:\"find . -name happy.py\"});",
  "if (!r.out.trim()) {",
  "  const r2 = await tools.bash({cmd:\"find / -name happy.py\"});",
  "  return {found:true};",
  "}",
].join("\n");
const condPos = SRC.indexOf("!r.out.trim()");

test("BF 7.3 basic example", () => {
  const trace: TraceEvent[] = [
    start(1, 3, "bash", { cmd: "find . -name happy.py" }), end(1, 12, 12, { code: 0, out: "" }),
    { type: "cond", line: 4, kind: "if", value: true, pos: condPos, end: condPos + 13, t: 13 },
    start(2, 5, "bash", { cmd: "find / -name happy.py" }, 13), end(2, 853, 840, { code: 0, out: "/home/user/happy.py" }),
    { type: "return", line: 6, value: { found: true, path: "/home/user/happy.py" }, t: 854 },
  ];
  assert.equal(render(ok(trace), SRC), [
    'L3  bash({cmd:"find . -name happy.py"}) → {code:0, out:""} (12ms)',
    "L4  if (!r.out.trim()) → true",
    'L5  bash({cmd:"find / -name happy.py"}) → {code:0, out:"/home/user/happy.py"} (840ms)',
    'L6  return {found:true, path:"/home/user/happy.py"}',
  ].join("\n"));
});

test("unhandled call failure with stack", () => {
  const trace: TraceEvent[] = [
    start(1, 9, "readFile", { path: "cfg.json" }), fail(1, 2, "ENOENT: no such file or directory"),
    { type: "error", message: "ENOENT: no such file or directory", lines: [9, 14, 20], tool: "readFile", callId: 1, t: 3 },
  ];
  const r: BranchResult = { ok: false, error: "thrown", message: "ENOENT: no such file or directory", line: 9, trace };
  assert.equal(render(r), [
    'L9  readFile({path:"cfg.json"}) ✗ ENOENT: no such file or directory',
    "    at L9 ← L14 ← L20",
  ].join("\n"));
});

test("throw not from a call", () => {
  const trace: TraceEvent[] = [{ type: "error", message: "boom", lines: [9, 14], t: 1 }];
  const r: BranchResult = { ok: false, error: "thrown", message: "boom", trace };
  assert.equal(render(r), "L9  throw: boom\n    at L9 ← L14");
});

test("loop collapse with distinct errors", () => {
  const trace: TraceEvent[] = [{ type: "loop", phase: "enter", line: 12, kind: "for", endLine: 15, t: 0 }];
  let id = 0;
  for (let i = 1; i <= 50; i++) {
    trace.push({ type: "loop", phase: "iter", line: 12, t: i });
    id++;
    trace.push(start(id, 13, "readFile", { i }, i));
    trace.push(i === 7 || i === 31 ? fail(id, i, "ENOENT") : end(id, i, 1, "x"));
  }
  trace.push({ type: "loop", phase: "exit", line: 12, t: 99 });
  assert.equal(render(ok(trace)), "L12–15  for ×50 (48 ok, 2 err)\n        L13 readFile ✗ ENOENT ×2 (iterations 7, 31)");
});

test("small loop is expanded; nested loop folds into collapsed outer", () => {
  const iter = (line: number): TraceEvent => ({ type: "loop", phase: "iter", line, t: 0 });
  const enter = (line: number, endLine: number): TraceEvent => ({ type: "loop", phase: "enter", line, kind: "for-of", endLine, t: 0 });
  const exit = (line: number): TraceEvent => ({ type: "loop", phase: "exit", line, t: 0 });
  const small = [enter(2, 4), iter(2), start(1, 3, "a", {}), end(1, 1, 1, 1), iter(2), start(2, 3, "a", {}), end(2, 2, 1, 2), exit(2)];
  assert.equal(render(ok(small)), "L3  a({}) → 1 (1ms)\nL3  a({}) → 2 (1ms)");

  const nested: TraceEvent[] = [enter(1, 9)];
  let id = 0;
  for (let i = 0; i < 4; i++) {
    nested.push(iter(1), enter(2, 8), iter(2), start(++id, 5, "x", {}), fail(id, 0, "bad"), exit(2));
  }
  nested.push(exit(1));
  assert.equal(render(ok(nested)), "L1–9  for ×4 (0 ok, 4 err)\n        L5 x ✗ bad ×4 (iterations 1, 2, 3, 4)");
});

test("concurrent calls carry ids, ordered by start", () => {
  const trace = [
    start(1, 5, "readFile", { path: "a" }), start(2, 5, "readFile", { path: "b" }),
    end(2, 5, 5, "B"), end(1, 8, 8, "A"), start(3, 6, "x", {}, 9), end(3, 10, 1, 0),
  ];
  assert.equal(render(ok(trace)), [
    'L5  #1 readFile({path:"a"}) → "A" (8ms)',
    'L5  #2 readFile({path:"b"}) → "B" (5ms)',
    "L6  x({}) → 0 (1ms)",
  ].join("\n"));
});

test("in-flight abort at timeout, state reverted", () => {
  const r: BranchResult = {
    ok: false, error: "timeout", message: "timeout", stateReverted: true, droppedKeys: ["a", "b"],
    trace: [start(1, 7, "runTests", {}, 0), { type: "call", phase: "end", id: 1, ok: false, t: 120000, ms: 120000, aborted: true }],
  };
  assert.equal(render(r), [
    "L7  runTests({}) … aborted after 120000ms (in flight)",
    "    [aborted: timeout]",
    "    [state reverted to the last tool-call snapshot]",
    "    [state keys dropped (not JSON): a, b]",
  ].join("\n"));
});

test("cut trace (no end event) and other kill markers", () => {
  const trace = [start(1, 2, "slow", {}, 10), { type: "log", line: 3, level: "log", message: "x", t: 510 } as TraceEvent];
  const a = render({ ok: false, error: "aborted", message: "", trace });
  assert.equal(a, "L2  slow({}) … aborted after 500ms (in flight)\nL3  log: x\n    [aborted]");
  assert.match(render({ ok: false, error: "memory", message: "", trace: [] }), /^ {4}\[memory limit exceeded\]$/);
});

test("compile error", () => {
  assert.equal(render({ ok: false, error: "compile", message: "Unexpected token", line: 3, trace: [] }), "L3  compile error: Unexpected token");
});

test("switch, catch, ternary, whitespace collapse, log levels", () => {
  const src = 'switch (k) {\n  case "a: b":\n    break;\n}\ntry {} catch (e) { y }\nconst z = a\n  ? 1 : 2;';
  const cs = src.indexOf('case "a: b"');
  const cp = src.indexOf("catch (e)");
  const ap = src.indexOf("a\n  ? 1");
  const trace: TraceEvent[] = [
    { type: "cond", line: 2, kind: "switch", value: true, pos: cs, end: cs + 30, t: 0 },
    { type: "cond", line: 5, kind: "catch", value: true, pos: cp, end: cp + 14, t: 0 },
    { type: "cond", line: 6, kind: "ternary", value: false, pos: ap, end: ap + 1, t: 0 },
    { type: "log", line: 7, level: "warn", message: "careful", t: 0 },
    { type: "log", line: 8, level: "info", message: "hi", t: 0 },
  ];
  assert.equal(render(ok(trace), src), [
    'L2  case "a: b":', "L5  catch (e)", "L6  ?: a → false", "L7  warn: careful", "L8  log: hi",
  ].join("\n"));
});

test("event budget elides but keeps the final return", () => {
  const trace: TraceEvent[] = [];
  for (let i = 1; i <= 10; i++) trace.push({ type: "log", line: i, level: "log", message: `m${i}`, t: i });
  trace.push({ type: "return", line: 11, value: 1, t: 11 });
  const out = renderTrace(ok(trace), { mode: "trace", source: "", limits: { valueChars: 200, loopCollapse: 3, eventBudget: 4 } });
  assert.equal(out, ["L1  log: m1", "L2  log: m2", "L3  log: m3", "L4  log: m4", "…6 events elided", "L11  return 1"].join("\n"));
});

test("value truncation marker; full mode does not truncate", () => {
  const long = "x".repeat(300);
  const trace = [start(1, 1, "t", {}), end(1, 1, 1, long)];
  const out = render(ok(trace));
  assert.ok(out.includes(`"${"x".repeat(199)}…(+102 chars)`), out);
  assert.ok(render(ok(trace), "", "full").includes(`"${long}"`));
  assert.equal(compact({ code: 0, out: "", "a-b": [1, null] }, Infinity), '{code:0, out:"", "a-b":[1, null]}');
});

test("footer formats", () => {
  assert.equal(renderFooter({}), "");
  const files = Array.from({ length: 10 }, (_, i) => "y".repeat(4300 + i));
  assert.equal(
    renderFooter({ files, parser: { ref: "src/a.ts#parseConfig", v: "h" }, plan: "p".repeat(308), n: 3, ok: true, o: { a: 1 } }),
    "state: files(10 items, 42KB), parser(ref src/a.ts#parseConfig), plan(string, 310B), n(3), ok(true), o(1 keys, 7B)",
  );
  const out = renderTrace(ok([]), { mode: "trace", source: "", state: { n: 1 } });
  assert.equal(out, "state: n(1)");
});

test("full mode expands big loops", () => {
  const trace: TraceEvent[] = [{ type: "loop", phase: "enter", line: 1, kind: "while", endLine: 2, t: 0 }];
  for (let i = 1; i <= 5; i++) trace.push({ type: "loop", phase: "iter", line: 1, t: i }, start(i, 2, "f", {}), end(i, i, 1, i));
  trace.push({ type: "loop", phase: "exit", line: 1, t: 9 });
  assert.equal(render(ok(trace)).split("\n").length, 1);
  assert.equal(render(ok(trace), "", "full").split("\n").length, 5);
});

test("annotated mode", () => {
  const trace: TraceEvent[] = [
    start(1, 1, "bash", { cmd: "find ." }), end(1, 1, 1, { code: 0, out: "" }),
    { type: "cond", line: 2, kind: "if", value: true, pos: condPos, end: condPos + 13, t: 2 },
    start(2, 3, "bash", {}), fail(2, 3, "nope"),
    { type: "error", message: "nope", lines: [3], callId: 2, t: 4 },
  ];
  const r: BranchResult = { ok: false, error: "thrown", message: "nope", trace };
  assert.equal(renderTrace(r, { mode: "annotated", source: SRC, state: { a: 1 } }), [
    '1  const r = await tools.bash({cmd:"find . -name happy.py"});  // → {code:0, out:""}',
    "2  if (!r.out.trim()) {  // [taken]",
    '3    const r2 = await tools.bash({cmd:"find / -name happy.py"});  // [error: nope]',
    "4    return {found:true};",
    "5  }",
    "state: a(1)",
  ].join("\n"));
});
