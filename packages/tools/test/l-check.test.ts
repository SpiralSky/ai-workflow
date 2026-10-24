import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { catalog, Sidecar } from "../src/index.ts";
import { ctxOf, makeWorkspace, skipReason, venvEnv } from "./pyfixture.ts";

const BAD = "import os\n\n\ndef f(x: int) -> int:\n    return \"a\"\n";
const GOOD = "def g(x: int) -> int:\n    return x\n";
const root = makeWorkspace({
  "pkg/bad.py": BAD,
  "pkg/good.py": GOOD,
  "pkg/messy.py": "x = {  'a':1 }\nprint( x )\n",
  "pkg/messy2.py": "y=2\n",
  "notes.txt": "hi\n",
  "pyproject.toml": "[tool.ruff.format]\nquote-style = \"double\"\n",
});
const sc = new Sidecar({ root, env: venvEnv() });
const tools = Object.fromEntries(catalog("L", { root, sidecar: sc }).map((t) => [t.name, t]));
const run = (name: string, args: unknown, r = root) => tools[name]!.fn(args, ctxOf(r)) as Promise<any>;
after(() => sc.close());

test("check tools throw `no sidecar` without a sidecar", async () => {
  const bare = catalog("L", { root });
  await assert.rejects(bare.find((t) => t.name === "check")!.fn({}, ctxOf(root)), /no sidecar/);
  await assert.rejects(bare.find((t) => t.name === "format")!.fn({}, ctxOf(root)), /no sidecar/);
});

test("check: types and lint diagnostics, structured", { skip: skipReason }, async () => {
  const r = await run("check", { path: "pkg/bad.py" });
  const types = r.diagnostics.find((d: any) => d.source === "pyright");
  assert.deepEqual([types.path, types.line, types.col, types.severity, types.code], ["pkg/bad.py", 5, 12, "error", "reportReturnType"]);
  assert.match(types.message, /not assignable/);
  const lint = r.diagnostics.find((d: any) => d.source === "ruff");
  assert.deepEqual([lint.path, lint.line, lint.col, lint.code], ["pkg/bad.py", 1, 8, "F401"]);
  assert.equal(r.counts.error, 1);
});

test("check: kinds filter, whole workspace, clean file", { skip: skipReason }, async () => {
  const lintOnly = await run("check", { path: "pkg/bad.py", kinds: ["lint"] });
  assert.ok(lintOnly.diagnostics.every((d: any) => d.source === "ruff"));
  const typesOnly = await run("check", { kinds: ["types"] });
  assert.ok(typesOnly.diagnostics.every((d: any) => d.source === "pyright"));
  assert.ok(typesOnly.diagnostics.some((d: any) => d.path === "pkg/bad.py"));
  assert.ok(!typesOnly.diagnostics.some((d: any) => d.path === "pkg/good.py"));
  const clean = await run("check", { path: "pkg/good.py" });
  assert.deepEqual(clean.diagnostics, []);
  await assert.rejects(run("check", { path: "notes.txt" }), /unsupported language: txt/);
  await assert.rejects(run("check", { path: "../x" }), /path outside workspace/);
  await assert.rejects(run("check", { kinds: ["bogus"] }), /unknown kind/);
});

test("check: caps diagnostics with a truncated hint", { skip: skipReason }, async () => {
  const many = makeWorkspace({ "m.py": Array.from({ length: 70 }, (_, i) => `import mod${i}`).join("\n") + "\n" });
  const sc2 = new Sidecar({ root: many, env: venvEnv() });
  try {
    const t = catalog("L", { root: many, sidecar: sc2 }).find((x) => x.name === "check")!;
    const r: any = await t.fn({ kinds: ["lint"] }, ctxOf(many));
    assert.ok(r.diagnostics.length <= 40);
    assert.match(r.truncated, /showing \d+ of 70/);
  } finally { sc2.close(); }
});

test("format: configured formatter rewrites files and summarises", { skip: skipReason }, async () => {
  const r = await run("format", { path: "pkg/messy.py" });
  assert.equal(r.files.length, 1);
  assert.equal(r.files[0].path, "pkg/messy.py");
  assert.ok(r.files[0].added > 0 && r.files[0].removed > 0);
  assert.equal(readFileSync(`${root}/pkg/messy.py`, "utf8"), 'x = {"a": 1}\nprint(x)\n');
  assert.deepEqual((await run("format", {})).files.map((f: any) => f.path), ["pkg/messy2.py"]);
  assert.deepEqual((await run("format", {})).files, []);
  await assert.rejects(run("format", { path: "notes.txt" }), /unsupported language: txt/);
});

test("format: no formatter configured throws; black settings accepted", { skip: skipReason }, async () => {
  const bare = makeWorkspace({ "a.py": "x=1\n" });
  const blk = makeWorkspace({ "a.py": "x=1\n", "pyproject.toml": "[tool.black]\nline-length = 100\n" });
  const [s1, s2] = [new Sidecar({ root: bare, env: venvEnv() }), new Sidecar({ root: blk, env: venvEnv() })];
  try {
    const mk = (r: string, s: Sidecar) => catalog("L", { root: r, sidecar: s }).find((x) => x.name === "format")!;
    await assert.rejects(mk(bare, s1).fn({}, ctxOf(bare)), /no formatter configured/);
    assert.equal(((await mk(blk, s2).fn({}, ctxOf(blk))) as any).files[0].path, "a.py");
  } finally { s1.close(); s2.close(); }
});
