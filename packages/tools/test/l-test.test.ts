import assert from "node:assert/strict";
import { after, test } from "node:test";
import { catalog, Sidecar } from "../src/index.ts";
import { ctxOf, makeWorkspace, skipReason, venvEnv } from "./pyfixture.ts";

const root = makeWorkspace({
  "app/__init__.py": "",
  "app/calc.py": "def add(a, b):\n    return a + b\n\n\ndef boom():\n    raise KeyError('missing')\n",
  "tests/__init__.py": "",
  "tests/test_calc.py": [
    "import unittest",
    "from app.calc import add, boom",
    "",
    "",
    "class TestCalc(unittest.TestCase):",
    "    def test_ok(self):",
    "        print('noise')",
    "        self.assertEqual(add(1, 2), 3)",
    "",
    "    def test_bad(self):",
    "        self.assertEqual(add(1, 2), 4)",
    "",
    "    def test_err(self):",
    "        boom()",
    "",
    "    @unittest.skip('later')",
    "    def test_skipped(self):",
    "        pass",
    "",
    "    def test_sub(self):",
    "        for i in range(2):",
    "            with self.subTest(i=i):",
    "                self.assertEqual(i, 0)",
    "",
  ].join("\n"),
  "app/inner/__init__.py": "",
  "app/inner/test_deep.py": [
    "import unittest",
    "from tests.base import Base",
    "",
    "",
    "class TestDeep(Base):",
    "    def test_deep(self):",
    "        self.assertTrue(True)",
    "",
  ].join("\n"),
  "tests/base.py": "import unittest\n\n\nclass Base(unittest.TestCase):\n    def test_inherited(self):\n        self.assertTrue(True)\n",
  "loose/test_loose.py": "import unittest\n\n\nclass TestLoose(unittest.TestCase):\n    def test_x(self):\n        pass\n",
  "broken/test_import.py": "import no_such_module\n",
  "notes.txt": "hi\n",
});
const sc = new Sidecar({ root, env: venvEnv() });
const tools = Object.fromEntries(catalog("L", { root, sidecar: sc }).map((t) => [t.name, t]));
const run = (name: string, args: unknown, r = root, signal?: AbortSignal) => tools[name]!.fn(args, ctxOf(r, signal)) as Promise<any>;
after(() => sc.close());

test("test tools throw `no sidecar` without a sidecar", async () => {
  const bare = catalog("L", { root });
  for (const n of ["runTests", "listTests", "runSnippet"]) await assert.rejects(bare.find((t) => t.name === n)!.fn({ code: "1" }, ctxOf(root)), /no sidecar/);
});

test("listTests: static scan incl. nested package, inherited methods, loose dir", { skip: skipReason }, async () => {
  const r = await run("listTests", {});
  assert.deepEqual(r.tests, [
    "app/inner/test_deep.py#TestDeep.test_deep",
    "app/inner/test_deep.py#TestDeep.test_inherited",
    "loose/test_loose.py#TestLoose.test_x",
    "tests/test_calc.py#TestCalc.test_bad",
    "tests/test_calc.py#TestCalc.test_err",
    "tests/test_calc.py#TestCalc.test_ok",
    "tests/test_calc.py#TestCalc.test_skipped",
    "tests/test_calc.py#TestCalc.test_sub",
  ]);
  assert.deepEqual((await run("listTests", { path: "app" })).tests.length, 2);
  assert.deepEqual((await run("listTests", { path: "tests/test_calc.py" })).tests.length, 5);
  await assert.rejects(run("listTests", { path: "notes.txt" }), /unsupported language: txt/);
  await assert.rejects(run("listTests", { path: "nope" }), /no such file/);
});

test("listTests: symbol filter keeps tests that reach it", { skip: skipReason }, async () => {
  const r = await run("listTests", { symbol: "app/calc.py#add" });
  assert.ok(r.tests.includes("tests/test_calc.py#TestCalc.test_ok"));
  assert.ok(!r.tests.some((t: string) => t.startsWith("loose/")));
});

test("runTests: structured failures, errors, skips; no raw log", { skip: skipReason }, async () => {
  const r = await run("runTests", { target: "tests/test_calc.py" });
  assert.equal(r.passed, 1);
  assert.equal(r.skipped, 1);
  const by = Object.fromEntries(r.failed.map((f: any) => [f.id, f]));
  const bad = by["tests/test_calc.py#TestCalc.test_bad"];
  assert.equal(bad.kind, "failure");
  assert.match(bad.message, /AssertionError: 3 != 4/);
  assert.deepEqual(bad.location, { path: "tests/test_calc.py", line: 11 });
  assert.match(bad.excerpt, /assertEqual\(add\(1, 2\), 4\)/);
  assert.ok(!bad.excerpt.includes(root));
  const err = by["tests/test_calc.py#TestCalc.test_err"];
  assert.equal(err.kind, "error");
  assert.match(err.message, /KeyError: 'missing'/);
  assert.deepEqual(err.location, { path: "app/calc.py", line: 6 }); // deepest workspace frame
  const sub = r.failed.filter((f: any) => f.id.endsWith("test_sub"));
  assert.equal(sub.length, 1);
  assert.match(sub[0].message, /subtest/);
  assert.ok(!JSON.stringify(r).includes("noise"));
});

test("runTests: selection by id, class, nested package, all; import errors reported", { skip: skipReason }, async () => {
  const one = await run("runTests", { target: "tests/test_calc.py#TestCalc.test_ok" });
  assert.deepEqual([one.passed, one.failed.length], [1, 0]);
  const cls = await run("runTests", { target: "tests/test_calc.py#TestCalc" });
  assert.equal(cls.failed.length, 3);
  const nested = await run("runTests", { target: "app" });
  // Base is imported into test_deep but defined elsewhere: not run on its own, only as inherited by TestDeep
  assert.deepEqual([nested.passed, nested.failed.length], [2, 0]);
  const all = await run("runTests", {});
  assert.equal(all.passed, 1 + 2 + 1);
  const imp = all.failed.find((f: any) => f.id === "broken/test_import.py");
  assert.equal(imp.kind, "error");
  assert.match(imp.message, /ModuleNotFoundError/);
  assert.equal(all.failed.length, 4);
  const missing = await run("runTests", { target: "tests/test_calc.py#TestCalc.test_nope" });
  assert.equal(missing.failed[0].id, "tests/test_calc.py#TestCalc.test_nope");
  await assert.rejects(run("runTests", { target: "nope.py" }), /no such file/);
  await assert.rejects(run("runTests", { target: "notes.txt" }), /unsupported language: txt/);
  await assert.rejects(run("runTests", { target: "../x.py" }), /path outside workspace/);
  await assert.rejects(run("runTests", { target: "tests", failedOnly: true }), /not both/);
});

test("runTests: failedOnly re-runs the previous failures", { skip: skipReason }, async () => {
  const w = makeWorkspace({ "test_a.py": "import unittest\nimport os\n\n\nclass T(unittest.TestCase):\n    def test_flag(self):\n        self.assertTrue(os.path.exists('ok'))\n\n    def test_fine(self):\n        pass\n" });
  const s2 = new Sidecar({ root: w, env: venvEnv() });
  try {
    const t = catalog("L", { root: w, sidecar: s2 }).find((x) => x.name === "runTests")!;
    const call = (a: object) => t.fn(a, ctxOf(w)) as Promise<any>;
    await assert.rejects(call({ failedOnly: true }), /no previous runTests/);
    const first = await call({});
    assert.deepEqual([first.passed, first.failed.map((f: any) => f.id)], [1, ["test_a.py#T.test_flag"]]);
    const again = await call({ failedOnly: true });
    assert.deepEqual([again.passed, again.failed.length], [0, 1]);
    (await import("node:fs")).writeFileSync(`${w}/ok`, "");
    const fixed = await call({ failedOnly: true });
    assert.deepEqual([fixed.passed, fixed.failed.length], [1, 0]);
    assert.deepEqual(await call({ failedOnly: true }), { passed: 0, skipped: 0, failed: [] });
  } finally { s2.close(); }
});

test("runTests: timeout throws and kills the child; abort kills it too", { skip: skipReason }, async () => {
  const w = makeWorkspace({ "test_slow.py": "import time, unittest\n\n\nclass T(unittest.TestCase):\n    def test_slow(self):\n        time.sleep(30)\n" });
  const s2 = new Sidecar({ root: w, env: venvEnv() });
  try {
    const t = catalog("L", { root: w, sidecar: s2 }).find((x) => x.name === "runTests")!;
    const t0 = Date.now();
    await assert.rejects(t.fn({ timeoutMs: 600 }, ctxOf(w)), /timed out after 0.6s/);
    assert.ok(Date.now() - t0 < 10000);
    const ac = new AbortController();
    const p = t.fn({}, ctxOf(w, ac.signal));
    setTimeout(() => ac.abort(), 300);
    await assert.rejects(p, /aborted/);
    // the sidecar is free again promptly (the child was killed, not waited for)
    const t1 = Date.now();
    await s2.call("ping", {});
    assert.ok(Date.now() - t1 < 5000);
  } finally { s2.close(); }
});

test("runSnippet: stdout, stderr, last expression value", { skip: skipReason }, async () => {
  const r = await run("runSnippet", { code: "import sys\nfrom app.calc import add\nprint('hi')\nprint('err', file=sys.stderr)\nadd(2, 3)" });
  assert.deepEqual(r, { stdout: "hi\n", stderr: "err\n", value: "5" });
  const cwd = await run("runSnippet", { code: "import os; os.getcwd()" });
  assert.equal(cwd.value, JSON.stringify(root).replace(/"/g, "'"));
  const none = await run("runSnippet", { code: "x = 1" });
  assert.equal(none.value, undefined);
});

test("runSnippet: exception with a trimmed traceback; caps; timeout", { skip: skipReason }, async () => {
  const r = await run("runSnippet", { code: "from app.calc import boom\nboom()" });
  assert.equal(r.exception.type, "KeyError");
  assert.match(r.exception.traceback, /File "<snippet>", line 2/);
  assert.match(r.exception.traceback, /File "app\/calc.py", line 6/);
  assert.ok(!r.exception.traceback.includes("runpy"));
  const big = await run("runSnippet", { code: "print('x' * 100000)" });
  assert.ok(big.stdout.length < 4200 && /bytes cut/.test(big.stdout));
  const slow = await run("runSnippet", { code: "import time; print('start'); time.sleep(30)", timeoutMs: 500 });
  assert.equal(slow.timedOut, true);
  assert.match(slow.stdout, /start/);
  const syn = await run("runSnippet", { code: "def (" });
  assert.equal(syn.exception.type, "SyntaxError");
  await assert.rejects(run("runSnippet", { code: " " }), /code must be/);
});

const SHAPES = [
  "def sign(x):",
  "    if x > 0:",
  "        return 1",
  "    elif x < 0:",
  "        return -1",
  "    return 0",
  "",
  "",
  "def unused():",
  "    a = 1",
  "    return a",
  "",
].join("\n");
const cov = makeWorkspace({
  "app/__init__.py": "",
  "app/shapes.py": SHAPES,
  "tests/__init__.py": "",
  "tests/test_shapes.py": "import unittest\nfrom app.shapes import sign\n\n\nclass T(unittest.TestCase):\n    def test_pos(self):\n        self.assertEqual(sign(2), 1)\n",
});
const sc3 = new Sidecar({ root: cov, env: venvEnv() });
after(() => sc3.close());
const covRun = (name: string, args: unknown) => catalog("L", { root: cov, sidecar: sc3 }).find((t) => t.name === name)!.fn(args, ctxOf(cov)) as Promise<any>;

test("coverage: executed lines of a file and of a symbol, uncovered ranges", { skip: skipReason }, async () => {
  const r = await covRun("coverage", { target: "app/shapes.py" });
  assert.equal(r.path, "app/shapes.py");
  // def lines run at import; sign's body runs up to the first return; the rest of sign and all of unused do not
  assert.deepEqual(r.uncovered, [[4, 6], [10, 11]]);
  assert.deepEqual([r.covered, r.total], [4, 9]);
  assert.equal(r.percent, 44.4);
  assert.deepEqual(r.tests, { passed: 1, skipped: 0, failed: 0 });
  const sym = await covRun("coverage", { target: "app/shapes.py#sign" });
  assert.deepEqual([sym.symbol, sym.covered, sym.total, sym.uncovered], ["app/shapes.py#sign", 3, 6, [[4, 6]]]);
  const none = await covRun("coverage", { target: "app/shapes.py#unused", tests: "tests/test_shapes.py#T.test_pos" });
  assert.deepEqual([none.covered, none.total], [1, 3]); // only the def line
  await assert.rejects(covRun("coverage", { target: "app/shapes.py#nope" }), /symbol not found/);
  await assert.rejects(covRun("coverage", { target: "app/missing.py" }), /no such file/);
  await assert.rejects(covRun("coverage", { target: "x.txt" }), /unsupported language: txt/);
});

const RACE = makeWorkspace({
  "app/__init__.py": "",
  "app/counter.py": [
    "import time",
    "",
    "",
    "class Counter:",
    "    def __init__(self, start=0):",
    "        self.n = start",
    "",
    "    def incr(self, by=1):",
    "        v = self.n",
    "        time.sleep(0.002)",
    "        self.n = v + by",
    "        return self.n",
    "",
    "    def fail(self):",
    "        raise ValueError('nope')",
    "",
  ].join("\n"),
  "tests/__init__.py": "",
  "tests/test_counter.py": [
    "import threading",
    "import unittest",
    "from app.counter import Counter",
    "",
    "",
    "class T(unittest.TestCase):",
    "    def test_race(self):",
    "        c = Counter()",
    "        ts = [threading.Thread(target=c.incr) for _ in range(4)]",
    "        [t.start() for t in ts]",
    "        [t.join() for t in ts]",
    "        self.assertEqual(c.n, 4)",
    "",
    "    def test_fine(self):",
    "        self.assertEqual(Counter().incr(), 1)",
    "",
  ].join("\n"),
});
const sc4 = new Sidecar({ root: RACE, env: venvEnv() });
after(() => sc4.close());
const raceTool = (name: string, signal?: AbortSignal) => {
  const t = catalog("L", { root: RACE, sidecar: sc4 }).find((x) => x.name === name)!;
  return (args: unknown) => t.fn(args, ctxOf(RACE, signal)) as Promise<any>;
};

test("traceCalls: args, return, exception, threads, order; class traces __init__", { skip: skipReason }, async () => {
  const code = [
    "import threading",
    "from app.counter import Counter",
    "c = Counter(5)",
    "ts = [threading.Thread(target=c.incr, args=(i,), name='w%d' % i) for i in (1, 2)]",
    "[t.start() for t in ts]",
    "[t.join() for t in ts]",
    "try:",
    "    c.fail()",
    "except ValueError:",
    "    pass",
    "c.n",
  ].join("\n");
  const r = await raceTool("traceCalls")({ symbols: ["app/counter.py#Counter", "app/counter.py#Counter.incr", "app/counter.py#Counter.fail"], snippet: code });
  assert.equal(r.total, 4);
  assert.deepEqual(r.calls.map((c: any) => c.seq), [1, 2, 3, 4]);
  assert.equal(r.calls[0].symbol, "app/counter.py#Counter");
  assert.equal(r.calls[0].args.start, "5");
  const incr = r.calls.filter((c: any) => c.symbol.endsWith("Counter.incr"));
  assert.equal(incr.length, 2);
  assert.deepEqual(incr.map((c: any) => c.thread.name).sort(), ["w1", "w2"]);
  assert.notEqual(incr[0].thread.id, incr[1].thread.id);
  assert.ok(incr.every((c: any) => /^[678]$/.test(c.returned) && "by" in c.args));
  const fail = r.calls.find((c: any) => c.symbol.endsWith("fail"));
  assert.match(fail.raised, /ValueError: nope/);

  assert.ok(r.run.value);
});

test("traceCalls: asyncio task name, test mode, cap, errors", { skip: skipReason }, async () => {
  const trace = raceTool("traceCalls");
  const w = makeWorkspace({ "m.py": "import asyncio\n\n\nasync def work(x):\n    await asyncio.sleep(0)\n    return x * 2\n" });
  const s5 = new Sidecar({ root: w, env: venvEnv() });
  try {
    const t = catalog("L", { root: w, sidecar: s5 }).find((x) => x.name === "traceCalls")!;
    const r: any = await t.fn({ symbols: ["m.py#work"], snippet: "import asyncio\nfrom m import work\nasync def main():\n    return await asyncio.gather(*[asyncio.create_task(work(i), name='t%d' % i) for i in range(2)])\nasyncio.run(main())" }, ctxOf(w));
    assert.deepEqual(r.calls.map((c: any) => [c.task, c.returned]), [["t0", "0"], ["t1", "2"]]);
  } finally { s5.close(); }
  const viaTest = await trace({ symbols: ["app/counter.py#Counter.incr"], test: "tests/test_counter.py#T.test_race" });
  assert.equal(viaTest.total, 4);
  assert.deepEqual(viaTest.run.tests, { passed: 0, skipped: 0, failed: ["tests/test_counter.py#T.test_race"] });
  const many = await trace({ symbols: ["app/counter.py#Counter.fail"], snippet: "from app.counter import Counter\nc = Counter()\nfor _ in range(150):\n    try:\n        c.fail()\n    except ValueError:\n        pass" });
  assert.equal(many.calls.length, 100);
  assert.equal(many.total, 150);
  assert.match(many.truncated, /first 100 of 150/);
  await assert.rejects(trace({ symbols: ["app/counter.py#Nope"], snippet: "1" }), /symbol not found/);
  await assert.rejects(trace({ symbols: ["app/counter.py"], snippet: "1" }), /path#Name/);
  await assert.rejects(trace({ symbols: ["app/counter.py#Counter.incr"] }), /exactly one of snippet or test/);
  await assert.rejects(trace({ symbols: [], snippet: "1" }), /non-empty list/);
});

test("stressRun: racy test fails, passing test does not; distinct failures deduped", { skip: skipReason }, async () => {
  const stress = raceTool("stressRun");
  const racy = await stress({ test: "tests/test_counter.py#T.test_race", n: 8, parallel: 4 });
  assert.equal(racy.runs, 8);
  assert.ok(racy.failures > 0 && racy.failureRate > 0);
  assert.equal(racy.distinct.length, 1);
  assert.equal(racy.distinct[0].type, "AssertionError");
  assert.deepEqual(racy.distinct[0].location, { path: "tests/test_counter.py", line: 12 });
  assert.equal(racy.distinct[0].count, racy.failures);
  assert.equal(racy.distinct[0].firstRun, 1);
  const fine = await stress({ test: "tests/test_counter.py#T.test_fine", n: 5 });
  assert.deepEqual([fine.runs, fine.failures, fine.failureRate, fine.distinct], [5, 0, 0, []]);
});

test("stressRun: snippets, parallelism, distinct failures, timeouts, abort, arg checks", { skip: skipReason }, async () => {
  const stress = raceTool("stressRun");
  const bad = await stress({ snippet: "import os\nfrom app.counter import Counter\nif os.getpid() % 2:\n    Counter().fail()\nelse:\n    {}['k']", n: 10, parallel: 5 });
  assert.equal(bad.failures, 10);
  assert.equal(bad.failureRate, 1);
  assert.deepEqual(bad.distinct.map((d: any) => d.type).sort(), ["KeyError", "ValueError"].filter((t) => bad.distinct.some((d: any) => d.type === t)));
  assert.equal(bad.distinct.reduce((a: number, d: any) => a + d.count, 0), 10);
  const par = await stress({ snippet: "import time\ntime.sleep(0.4)", n: 8, parallel: 8 });
  assert.deepEqual([par.runs, par.failures], [8, 0]);
  const hang = await stress({ snippet: "import time\ntime.sleep(30)", n: 2, parallel: 2, runTimeoutMs: 300 });
  assert.equal(hang.failures, 2);
  assert.equal(hang.distinct[0].type, "Timeout");
  const cut = await stress({ snippet: "import time\ntime.sleep(0.3)", n: 20, parallel: 1, timeoutMs: 1000 });
  assert.equal(cut.timedOut, true);
  assert.ok(cut.runs >= 1 && cut.runs < 20 && cut.failures === 0);
  const crash = await stress({ snippet: "import os\nos._exit(3)", n: 2 });
  assert.equal(crash.distinct[0].type, "Crash");
  const ac = new AbortController();
  const p = raceTool("stressRun", ac.signal)({ snippet: "import time\ntime.sleep(30)", n: 4, parallel: 4 });
  setTimeout(() => ac.abort(), 300);
  await assert.rejects(p, /aborted/);
  const t1 = Date.now();
  await sc4.call("ping", {});
  assert.ok(Date.now() - t1 < 5000);
  await assert.rejects(stress({ n: 3 }), /exactly one of snippet or test/);
  await assert.rejects(stress({ snippet: "1", n: 0 }), /positive integer/);
});
