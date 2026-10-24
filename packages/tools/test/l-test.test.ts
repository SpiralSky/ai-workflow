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
const tools = Object.fromEntries(catalog("L", { root, sidecar: sc, partial: true }).map((t) => [t.name, t]));
const run = (name: string, args: unknown, r = root, signal?: AbortSignal) => tools[name]!.fn(args, ctxOf(r, signal)) as Promise<any>;
after(() => sc.close());

test("test tools throw `no sidecar` without a sidecar", async () => {
  const bare = catalog("L", { root, partial: true });
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
    const t = catalog("L", { root: w, sidecar: s2, partial: true }).find((x) => x.name === "runTests")!;
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
    const t = catalog("L", { root: w, sidecar: s2, partial: true }).find((x) => x.name === "runTests")!;
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
