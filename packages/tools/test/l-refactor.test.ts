import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { catalog, Sidecar } from "../src/index.ts";
import { ctxOf, findVenv, makeWorkspace, REFACTOR_PKG, skipReason, venvEnv } from "./pyfixture.ts";

/** Every file and directory under root (path to content, `null` for a directory). */
function tree(root: string, dir = ""): Record<string, string | null> {
  const out: Record<string, string | null> = {};
  for (const e of readdirSync(join(root, dir), { withFileTypes: true })) {
    const p = dir ? `${dir}/${e.name}` : e.name;
    if (e.isDirectory()) { out[p] = null; Object.assign(out, tree(root, p)); } else out[p] = readFileSync(join(root, p), "utf8");
  }
  return out;
}

/** Runs python code in the workspace with the tool venv (no bytecode written); returns stdout. */
function py(root: string, code: string): string {
  return execFileSync(`${findVenv()}/bin/python`, ["-c", code], { cwd: root, env: { ...process.env, PYTHONPATH: root, PYTHONDONTWRITEBYTECODE: "1" } }).toString().trim();
}

/** A fresh workspace with its own sidecar and the refactor tools; `done` closes the sidecar. */
function setup(files: Record<string, string> = REFACTOR_PKG) {
  const root = makeWorkspace(files);
  const sc = new Sidecar({ root, env: venvEnv() });
  const tools = Object.fromEntries(catalog("L", { root, sidecar: sc }).map((t) => [t.name, t]));
  const run = (name: string, args: unknown) => tools[name]!.fn(args, ctxOf(root)) as Promise<any>;
  return { root, run, done: () => sc.close() };
}

/** Asserts that a refactoring throws and leaves every byte of the workspace as it was. */
async function failsUntouched(ws: ReturnType<typeof setup>, name: string, args: unknown, msg: RegExp) {
  const before = tree(ws.root);
  await assert.rejects(ws.run(name, args), msg);
  assert.deepEqual(tree(ws.root), before);
}

const lines = (text: string) => text.replace(/\n$/, "").split("\n").length;
const SHOW = 'import pkg.views as v; from pkg.models import User; print(v.show(User("Ab Cd")), v.loud(User("x")), v.twice(4))';
const BASE_OUT = "ab_cd X 8";

test("refactor tools throw `no sidecar` without a sidecar", async () => {
  const root = makeWorkspace(REFACTOR_PKG);
  const names = ["renameSymbol", "moveSymbol", "moveModule", "extractFunction", "inlineSymbol", "changeSignature", "extractVariable", "organizeImports"];
  const tools = catalog("L", { root }).filter((t) => t.meta.category === "refactor");
  assert.deepEqual(tools.map((t) => t.name), names);
  assert.ok(tools.every((t) => t.meta.effect === "write"));
  for (const t of tools) await assert.rejects(t.fn({ path: "pkg/util.py", dryRun: true }, ctxOf(root)), /no sidecar/);
});

test("baseline fixture behaves as expected", { skip: skipReason }, () => {
  const ws = setup();
  try { assert.equal(py(ws.root, SHOW), BASE_OUT); } finally { ws.done(); }
});

test("renameSymbol: function, method, parameter; dryRun first; package still imports", { skip: skipReason }, async () => {
  const ws = setup();
  try {
    const before = tree(ws.root);
    const dry = await ws.run("renameSymbol", { symbol: "pkg/util.py#slugify", newName: "make_slug", dryRun: true });
    assert.deepEqual(tree(ws.root), before);
    assert.match(dry.diff, /\+def make_slug\(/);
    assert.deepEqual(dry.files.map((f: any) => f.path), ["pkg/__init__.py", "pkg/models.py", "pkg/util.py", "pkg/views.py"]);
    const r = await ws.run("renameSymbol", { symbol: "pkg/util.py#slugify", newName: "make_slug" });
    assert.deepEqual(r.files, dry.files);
    assert.ok(r.files.every((f: any) => f.added >= 1 && f.removed >= 1));
    assert.equal(py(ws.root, SHOW), BASE_OUT);
    assert.equal(py(ws.root, "import pkg; print(pkg.make_slug('A B'))"), "a-b");
    assert.ok(!readFileSync(join(ws.root, "pkg/views.py"), "utf8").includes("slugify"));
    // parameter: keyword arguments at call sites follow
    await ws.run("renameSymbol", { path: "pkg/util.py", name: "sep", line: 3, newName: "separator" });
    assert.match(readFileSync(join(ws.root, "pkg/views.py"), "utf8"), /separator="_"/);
    assert.equal(py(ws.root, SHOW), BASE_OUT);
    // method
    await ws.run("renameSymbol", { symbol: "pkg/models.py#User.slug", newName: "to_slug" });
    assert.equal(py(ws.root, "from pkg.models import User; print(User('A B').to_slug())"), "a-b");
    assert.ok(!existsSync(join(ws.root, ".ropeproject")));
  } finally { ws.done(); }
});

test("renameSymbol: unresolvable uses are listed in `unsure`, not changed", { skip: skipReason }, async () => {
  const ws = setup();
  try {
    const r = await ws.run("renameSymbol", { path: "pkg/models.py", name: "name", line: 5, newName: "label" });
    assert.deepEqual(r.unsure, [{ path: "pkg/views.py", line: 14 }]);
    const views = readFileSync(join(ws.root, "pkg/views.py"), "utf8");
    assert.match(views, /return obj\.name/); // untyped receiver: left alone
    assert.match(views, /shout\(u\.label\)/); // annotated receiver: resolved by jedi and renamed
    assert.match(views, /slugify\(u\.label, sep/);
  } finally { ws.done(); }
});

test("moveSymbol: creates the target module and package, rewrites users; keepReexport", { skip: skipReason }, async () => {
  const ws = setup();
  try {
    const before = tree(ws.root);
    const dry = await ws.run("moveSymbol", { symbol: "pkg/util.py#shout", to: "pkg/text/loud.py", dryRun: true });
    assert.deepEqual(tree(ws.root), before);
    const r = await ws.run("moveSymbol", { symbol: "pkg/util.py#shout", to: "pkg/text/loud.py" });
    assert.deepEqual(r.files, dry.files);
    const paths = r.files.map((f: any) => f.path);
    for (const p of ["pkg/text/__init__.py", "pkg/text/loud.py", "pkg/util.py", "pkg/views.py"]) assert.ok(paths.includes(p), p);
    assert.deepEqual(r.files.find((f: any) => f.path === "pkg/text/loud.py"), { path: "pkg/text/loud.py", added: 2, removed: 0 });
    assert.equal(py(ws.root, SHOW), BASE_OUT);
    assert.ok(!readFileSync(join(ws.root, "pkg/util.py"), "utf8").includes("shout"));
    assert.ok(!readFileSync(join(ws.root, "pkg/text/loud.py"), "utf8").includes("DEFAULT"));
    // keepReexport: the old import path keeps working
    const ws2 = setup();
    try {
      await ws2.run("moveSymbol", { symbol: "pkg/util.py#double", to: "pkg/mathy.py", keepReexport: true });
      assert.match(readFileSync(join(ws2.root, "pkg/util.py"), "utf8"), /from pkg\.mathy import double/);
      assert.equal(py(ws2.root, "from pkg.util import double; import pkg.views as v; print(double(3), v.twice(4))"), "6 8");
      await ws.run("moveSymbol", { symbol: "pkg/util.py#double", to: "pkg/mathy.py" });
      assert.ok(!readFileSync(join(ws.root, "pkg/util.py"), "utf8").includes("double"));
    } finally { ws2.done(); }
    assert.ok(!existsSync(join(ws.root, ".ropeproject")));
  } finally { ws.done(); }
});

test("moveSymbol: refuses an import cycle and methods, workspace untouched", { skip: skipReason }, async () => {
  const ws = setup();
  try {
    // util would import mathy (re-export) while mathy needs DEFAULT_SEP from util
    await ws.run("moveSymbol", { symbol: "pkg/util.py#double", to: "pkg/mathy.py" });
    await failsUntouched(ws, "moveSymbol", { symbol: "pkg/util.py#slugify", to: "pkg/slug.py", keepReexport: true }, /import cycle/);
    await failsUntouched(ws, "moveSymbol", { symbol: "pkg/models.py#User.slug", to: "pkg/x.py" }, /module-level/);
    await failsUntouched(ws, "moveSymbol", { symbol: "pkg/util.py#shout", to: "notes.txt" }, /unsupported language: txt/);
    await failsUntouched(ws, "moveSymbol", { symbol: "pkg/util.py#shout", to: "../out.py" }, /path outside workspace/);
  } finally { ws.done(); }
});

test("moveModule: rename, move into a new package, move a package; counts follow A-30", { skip: skipReason }, async () => {
  const ws = setup();
  try {
    const orig = lines(REFACTOR_PKG["pkg/util.py"]!);
    const before = tree(ws.root);
    const dry = await ws.run("moveModule", { from: "pkg/util.py", to: "pkg/helpers.py", dryRun: true });
    assert.deepEqual(tree(ws.root), before);
    const r = await ws.run("moveModule", { from: "pkg/util.py", to: "pkg/helpers.py" });
    assert.deepEqual(r.files, dry.files);
    assert.deepEqual(r.files.find((f: any) => f.path === "pkg/util.py"), { path: "pkg/util.py", added: 0, removed: orig });
    assert.deepEqual(r.files.find((f: any) => f.path === "pkg/helpers.py"), { path: "pkg/helpers.py", added: orig, removed: 0 });
    assert.ok(!existsSync(join(ws.root, "pkg/util.py")));
    assert.equal(py(ws.root, SHOW), BASE_OUT);
    // into a package that does not exist yet
    await ws.run("moveModule", { from: "pkg/helpers.py", to: "pkg/core/helpers.py" });
    assert.ok(existsSync(join(ws.root, "pkg/core/__init__.py")));
    assert.equal(py(ws.root, SHOW), BASE_OUT);
    // a whole package, with a non-Python file inside
    const ws2 = setup({ ...REFACTOR_PKG, "pkg/data.txt": "x\n" });
    try {
      await ws2.run("moveModule", { from: "pkg", to: "lib/pkg" });
      assert.deepEqual(Object.keys(tree(ws2.root)).filter((p) => p.endsWith(".py") || p.endsWith(".txt")).sort(),
        ["lib/pkg/__init__.py", "lib/pkg/calc.py", "lib/pkg/data.txt", "lib/pkg/messy.py", "lib/pkg/models.py", "lib/pkg/util.py", "lib/pkg/views.py", "notes.txt"]);
      assert.ok(!existsSync(join(ws2.root, "pkg")));
    } finally { ws2.done(); }
  } finally { ws.done(); }
});

test("moveModule: refusals leave the workspace untouched", { skip: skipReason }, async () => {
  const ws = setup();
  try {
    await failsUntouched(ws, "moveModule", { from: "pkg/util.py", to: "pkg/models.py" }, /target exists/);
    await failsUntouched(ws, "moveModule", { from: "pkg/util.py", to: "pkg/sub/other.py" }, /either the directory or the name/);
    await failsUntouched(ws, "moveModule", { from: "notes.txt", to: "n.txt" }, /unsupported language: txt/);
    await failsUntouched(ws, "moveModule", { from: "pkg/nope.py", to: "pkg/x.py" }, /no such module/);
    await failsUntouched(ws, "moveModule", { from: "pkg/util.py", to: "../x.py" }, /path outside workspace/);
    await failsUntouched(ws, "moveModule", { from: "pkg", to: "pkg/inner" }, /into itself/);
  } finally { ws.done(); }
});

test("extractFunction: lines become a function; behaviour unchanged", { skip: skipReason }, async () => {
  const ws = setup();
  try {
    const call = "from pkg.calc import total, Acc; print(total([1, 2, 3], 2), Acc().add(2, 3))";
    const expected = py(ws.root, call);
    const before = tree(ws.root);
    const dry = await ws.run("extractFunction", { path: "pkg/calc.py", range: [5, 6], name: "double_all", dryRun: true });
    assert.deepEqual(tree(ws.root), before);
    assert.match(dry.diff, /\+def double_all\(items, s\):/);
    await ws.run("extractFunction", { path: "pkg/calc.py", range: [5, 6], name: "double_all" });
    assert.match(readFileSync(join(ws.root, "pkg/calc.py"), "utf8"), /s = double_all\(items, s\)/);
    assert.equal(py(ws.root, call), expected);
    // inside a method it becomes a method
    await ws.run("extractFunction", { path: "pkg/calc.py", range: [19, 20], name: "twice" });
    assert.match(readFileSync(join(ws.root, "pkg/calc.py"), "utf8"), /self\.twice\(x, y\)/);
    assert.equal(py(ws.root, call), expected);
    await failsUntouched(ws, "extractFunction", { path: "pkg/calc.py", range: [3, 99], name: "f" }, /out of bounds/);
    await failsUntouched(ws, "extractFunction", { path: "pkg/calc.py", range: [5, 6], name: "not valid" }, /valid identifier/);
    await failsUntouched(ws, "extractFunction", { path: "notes.txt", range: [1, 1], name: "f" }, /unsupported language: txt/);
  } finally { ws.done(); }
});

test("inlineSymbol: function and variable; unsafe substitutions are refused", { skip: skipReason }, async () => {
  const ws = setup({
    ...REFACTOR_PKG,
    "pkg/c.py": "def sq(a):\n    return a * a\n\ndef plus(a, b):\n    return a + b\n\ndef f(x):\n    k = x + 1\n    return k * k\n\nq = 5\nr = sq(q)\ns = 2 * plus(q, 1)\nt = sq(1 + 2)\n",
    "pkg/d.py": "def sq(a):\n    return a * a\n\ncb = sq\nr = sq(3)\n",
    "pkg/e.py": "def g(it):\n    k = next(it)\n    return k + k\n",
  });
  try {
    await failsUntouched(ws, "inlineSymbol", { symbol: "pkg/c.py#plus" }, /larger expression/);
    await failsUntouched(ws, "inlineSymbol", { symbol: "pkg/c.py#sq" }, /compound expression/);
    await failsUntouched(ws, "inlineSymbol", { symbol: "pkg/d.py#sq" }, /other than by calling/);
    await failsUntouched(ws, "inlineSymbol", { path: "pkg/e.py", name: "k", line: 2 }, /repeat the call/);
    await failsUntouched(ws, "inlineSymbol", { symbol: "pkg/models.py#User" }, /Inline refactoring|inline/i);
    // a variable: the compound value keeps its parentheses
    await ws.run("inlineSymbol", { path: "pkg/c.py", name: "k", line: 8 });
    assert.match(readFileSync(join(ws.root, "pkg/c.py"), "utf8"), /return \(x \+ 1\) \* \(x \+ 1\)/);
    assert.equal(py(ws.root, "from pkg.c import f; print(f(2))"), "9");
    // a function: every call replaced, definition removed, importers cleaned
    const before = tree(ws.root);
    const dry = await ws.run("inlineSymbol", { symbol: "pkg/util.py#shout", dryRun: true });
    assert.deepEqual(tree(ws.root), before);
    assert.match(dry.diff, /-def shout/);
    await ws.run("inlineSymbol", { symbol: "pkg/util.py#shout" });
    assert.match(readFileSync(join(ws.root, "pkg/views.py"), "utf8"), /return u\.name\.upper\(\)/);
    assert.equal(py(ws.root, SHOW), BASE_OUT);
  } finally { ws.done(); }
});

test("changeSignature: add, rename, reorder, remove; every call site; annotations kept", { skip: skipReason }, async () => {
  const ws = setup({
    ...REFACTOR_PKG,
    "pkg/sig.py": "def f(a: int, b: str = 'x', c=1) -> str:\n    return f'{a}{b}{c}'\n\nclass K:\n    def m(self, p, q):\n        return p - q\n",
    "pkg/use.py": "from pkg.sig import f, K\n\nr1 = f(1)\nr2 = f(1, 'y', 3)\nr3 = f(c=4, a=2)\nr4 = K().m(10, 3)\nk = K()\nr5 = k.m(q=1, p=5)\n\ndef call(x: K):\n    return x.m(8, 2)\n\nr6 = call(K())\n",
  });
  try {
    const out = "import pkg.use as u; print(u.r1, u.r2, u.r3, u.r4, u.r5, u.r6)";
    const base = py(ws.root, out);
    // add with default; annotations on the other parameters survive; callers need no change
    const before = tree(ws.root);
    const dry = await ws.run("changeSignature", { symbol: "pkg/sig.py#f", ops: [{ op: "add", name: "d", default: "0" }], dryRun: true });
    assert.deepEqual(tree(ws.root), before);
    assert.match(dry.diff, /def f\(a: int, b: str = 'x', c=1, d=0\) -> str:/);
    await ws.run("changeSignature", { symbol: "pkg/sig.py#f", ops: [{ op: "add", name: "d", default: "0" }] });
    assert.equal(py(ws.root, out), base);
    // rename then reorder in one call; callers (positional and keyword) follow
    await ws.run("changeSignature", { symbol: "pkg/sig.py#f", ops: [{ op: "rename", name: "a", to: "first" }, { op: "reorder", order: ["first", "b", "d", "c"] }] });
    assert.match(readFileSync(join(ws.root, "pkg/sig.py"), "utf8"), /def f\(first: int, b: str = 'x', d=0, c=1\)/);
    assert.match(readFileSync(join(ws.root, "pkg/use.py"), "utf8"), /f\(first=2, c=4\)|f\(2, c=4\)/);
    assert.equal(py(ws.root, out), base);
    // a method reordered: positional and keyword callers
    await ws.run("changeSignature", { symbol: "pkg/sig.py#K.m", ops: [{ op: "reorder", order: ["self", "q", "p"] }] });
    assert.equal(py(ws.root, out), base);
    // remove an unused parameter; refused while the body uses it
    await failsUntouched(ws, "changeSignature", { symbol: "pkg/sig.py#f", ops: [{ op: "remove", name: "first" }] }, /still used in the body/);
    await ws.run("changeSignature", { symbol: "pkg/sig.py#f", ops: [{ op: "remove", name: "d" }] });
    assert.equal(py(ws.root, out), base);
    assert.match(readFileSync(join(ws.root, "pkg/sig.py"), "utf8"), /def f\(first: int, b: str = 'x', c=1\) -> str/);
    await failsUntouched(ws, "changeSignature", { symbol: "pkg/sig.py#f", ops: [{ op: "rename", name: "nope", to: "x" }] }, /no parameter nope/);
    await failsUntouched(ws, "changeSignature", { symbol: "pkg/sig.py#f", ops: [{ op: "add", name: "z", default: "1", index: 0 }] }, /default cannot come before/);
    await failsUntouched(ws, "changeSignature", { symbol: "pkg/sig.py#f", ops: [{ op: "add", name: "z" }] }, /needs a default/);
    await failsUntouched(ws, "changeSignature", { symbol: "pkg/sig.py#f", ops: [] }, /non-empty/);
  } finally { ws.done(); }
});

test("changeSignature: constructor through the class name", { skip: skipReason }, async () => {
  const ws = setup({ ...REFACTOR_PKG, "pkg/make.py": "from pkg.models import User\n\nu = User('Zed')\nv = User(name='Amy')\n" });
  try {
    await ws.run("changeSignature", { symbol: "pkg/models.py#User", ops: [{ op: "add", name: "age", default: "0" }] });
    assert.match(readFileSync(join(ws.root, "pkg/models.py"), "utf8"), /def __init__\(self, name: str, age=0\) -> None:/);
    assert.equal(py(ws.root, "import pkg.make as m; print(m.u.name, m.v.name, m.u.slug())"), "Zed Amy zed");
  } finally { ws.done(); }
});

test("extractVariable: local and module scope", { skip: skipReason }, async () => {
  const ws = setup();
  try {
    const call = "from pkg.calc import total, day_seconds; print(total([1, 2], 3), day_seconds(1))";
    const expected = py(ws.root, call);
    const before = tree(ws.root);
    const dry = await ws.run("extractVariable", { path: "pkg/calc.py", line: 7, expression: "s * rate", name: "gross", dryRun: true });
    assert.deepEqual(tree(ws.root), before);
    assert.match(dry.diff, /\+    gross = s \* rate/);
    await ws.run("extractVariable", { path: "pkg/calc.py", line: 7, expression: "s * rate", name: "gross" });
    assert.equal(py(ws.root, call), expected);
    await ws.run("extractVariable", { path: "pkg/calc.py", line: 12, expression: "3600 * 24", name: "DAY", scope: "module" });
    const src = readFileSync(join(ws.root, "pkg/calc.py"), "utf8");
    assert.match(src, /^DAY = 3600 \* 24$/m);
    assert.match(src, /return x \+ DAY/);
    assert.equal(py(ws.root, call), expected);
    await failsUntouched(ws, "extractVariable", { path: "pkg/calc.py", line: 9, expression: "math.floor(s)", name: "F", scope: "module" }, /local names \(s\)/);
    await failsUntouched(ws, "extractVariable", { path: "pkg/calc.py", line: 5, expression: "i", name: "v" }, /occurs \d+ times|not found/);
    await failsUntouched(ws, "extractVariable", { path: "pkg/calc.py", line: 6, expression: "s +=", name: "v" }, /single valid Python expression/);
    await failsUntouched(ws, "extractVariable", { path: "pkg/calc.py", line: 6, expression: "nothing", name: "v" }, /not found on line/);
  } finally { ws.done(); }
});

test("organizeImports: unused removed, safe local imports hoisted, unsafe ones reported; idempotent", { skip: skipReason }, async () => {
  const ws = setup();
  try {
    const before = tree(ws.root);
    const dry = await ws.run("organizeImports", { path: "pkg/messy.py", dryRun: true });
    assert.deepEqual(tree(ws.root), before);
    assert.match(dry.diff, /-import unused_mod/);
    const r = await ws.run("organizeImports", { path: "pkg/messy.py" });
    assert.deepEqual(r.hoisted.map((h: any) => h.statement), ["import re", "import math", "import os"]);
    assert.deepEqual(r.notHoisted.map((h: any) => [h.statement, h.reason.split(":")[0]]), [
      ["import requests", "not stdlib and may cause an import cycle or import-time side effects"],
      ["import string", "it is the only statement of the function"],
    ]);
    const src = readFileSync(join(ws.root, "pkg/messy.py"), "utf8");
    assert.match(src, /^"""Messy imports\."""\nimport json\nimport math\nimport os\nimport re\n/);
    assert.ok(!src.includes("unused_mod") && !src.includes("import sys") && !src.includes("shout"));
    assert.match(src, /def a\(x\):\n    import requests\n/);
    assert.match(src, /def only\(\):\n    import string/);
    assert.equal(py(ws.root, "import pkg.messy as m; print(m.b()[1])"), "{}");
    assert.deepEqual((await ws.run("organizeImports", { path: "pkg/messy.py" })).files, []);
    // a package __init__ keeps its re-exports
    assert.deepEqual((await ws.run("organizeImports", { path: "pkg/__init__.py" })).files, []);
    assert.equal(py(ws.root, "import pkg; print(pkg.slugify('A B'))"), "a-b");
  } finally { ws.done(); }
});

test("organizeImports: workspace imports are hoisted only when no import cycle can result", { skip: skipReason }, async () => {
  const ws = setup({
    "app/__init__.py": "",
    "app/a.py": "def f():\n    from app import b\n    from app import leaf\n    return b.g(), leaf.X\n",
    "app/b.py": "def g():\n    from app import a\n    return a\n",
    "app/leaf.py": "X = 1\n",
  });
  try {
    const r = await ws.run("organizeImports", { path: "app/a.py" });
    assert.deepEqual(r.hoisted.map((h: any) => h.statement), ["from app import leaf"]);
    assert.equal(r.notHoisted.length, 1);
    assert.match(r.notHoisted[0].reason, /import cycle/);
    assert.match(readFileSync(join(ws.root, "app/a.py"), "utf8"), /^from app import leaf\n/);
    assert.equal(py(ws.root, "import app.a as a; print(a.f()[1])"), "1");
  } finally { ws.done(); }
});

test("a failing refactoring leaves the workspace byte-identical; no .ropeproject", { skip: skipReason }, async () => {
  const ws = setup({ ...REFACTOR_PKG, "pkg/broken.py": "def oops(:\n" });
  try {
    await failsUntouched(ws, "renameSymbol", { symbol: "pkg/util.py#slugify", newName: "class" }, /valid identifier/);
    await failsUntouched(ws, "renameSymbol", { symbol: "pkg/util.py#nope", newName: "x" }, /symbol not found/);
    await failsUntouched(ws, "renameSymbol", { symbol: "pkg/util.py#slugify" }, /newName/);
    await failsUntouched(ws, "renameSymbol", { symbol: "pkg/broken.py#oops", newName: "x" }, /syntax error/);
    await failsUntouched(ws, "inlineSymbol", { symbol: "pkg/models.py#User" }, /./);
    // rope itself rejects this one (not a function)
    await failsUntouched(ws, "changeSignature", { symbol: "pkg/util.py#DEFAULT_SEP", ops: [{ op: "add", name: "x", default: "1" }] }, /functions|signature/i);
    assert.ok(!existsSync(join(ws.root, ".ropeproject")));
  } finally { ws.done(); }
});

test("non-Python files and paths outside the workspace are refused", { skip: skipReason }, async () => {
  const ws = setup({ ...REFACTOR_PKG, "app.ts": "export const a = 1;\n" });
  try {
    for (const [name, args] of [
      ["renameSymbol", { path: "app.ts", name: "a", newName: "b" }],
      ["extractFunction", { path: "app.ts", range: [1, 1], name: "f" }],
      ["extractVariable", { path: "app.ts", line: 1, expression: "1", name: "v" }],
      ["organizeImports", { path: "app.ts" }],
      ["inlineSymbol", { path: "app.ts", name: "a" }],
      ["changeSignature", { path: "app.ts", name: "a", ops: [{ op: "remove", name: "x" }] }],
      ["moveSymbol", { path: "app.ts", name: "a", to: "pkg/x.py" }],
    ] as const) await failsUntouched(ws, name, args, /unsupported language: ts/);
    await failsUntouched(ws, "organizeImports", { path: "../x.py" }, /path outside workspace/);
    await failsUntouched(ws, "renameSymbol", { symbol: "../x.py#a", newName: "b" }, /path outside workspace/);
  } finally { ws.done(); }
});

test("a write failure part-way rolls everything back", { skip: skipReason ?? (process.getuid?.() === 0 ? "root ignores file modes" : undefined) }, async () => {
  const ws = setup();
  try {
    chmodSync(join(ws.root, "pkg/views.py"), 0o444);
    await failsUntouched(ws, "renameSymbol", { symbol: "pkg/util.py#slugify", newName: "make_slug" }, /refactoring failed: PermissionError/);
    assert.equal(statSync(join(ws.root, "pkg/views.py")).mode & 0o777, 0o444);
    chmodSync(join(ws.root, "pkg/views.py"), 0o644);
    assert.equal(py(ws.root, SHOW), BASE_OUT);
  } finally { ws.done(); }
});

test("rope runs no VCS commands in a git workspace and leaves no rope folder", { skip: skipReason }, async () => {
  const ws = setup();
  try {
    const git = (...a: string[]) => execFileSync("git", a, { cwd: ws.root, env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@t", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@t" } }).toString();
    git("init", "-q");
    git("add", "-A");
    git("commit", "-qm", "init");
    await ws.run("moveModule", { from: "pkg/util.py", to: "pkg/helpers.py" });
    assert.equal(git("diff", "--cached", "--name-only").trim(), "", "nothing staged");
    assert.ok(!existsSync(join(ws.root, ".ropeproject")));
    assert.equal(py(ws.root, SHOW), BASE_OUT);
  } finally { ws.done(); }
});

test("nav results see the refactored files", { skip: skipReason }, async () => {
  const ws = setup();
  try {
    assert.ok((await ws.run("outline", { path: "pkg/util.py" })).items.some((i: any) => i.symbol === "pkg/util.py#slugify"));
    await ws.run("renameSymbol", { symbol: "pkg/util.py#slugify", newName: "make_slug" });
    const names = (await ws.run("outline", { path: "pkg/util.py" })).items.map((i: any) => i.symbol);
    assert.ok(names.includes("pkg/util.py#make_slug") && !names.includes("pkg/util.py#slugify"));
    assert.ok((await ws.run("findReferences", { symbol: "pkg/util.py#make_slug" })).references.some((r: any) => r.path === "pkg/views.py"));
    await ws.run("moveModule", { from: "pkg/util.py", to: "pkg/helpers.py" });
    assert.ok((await ws.run("overview", {})).modules.some((m: any) => JSON.stringify(m).includes("helpers")));
    await assert.rejects(ws.run("outline", { path: "pkg/util.py" }), /./);
  } finally { ws.done(); }
});
