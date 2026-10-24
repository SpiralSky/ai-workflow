import assert from "node:assert/strict";
import { after, test } from "node:test";
import { catalog, Sidecar } from "../src/index.ts";
import { ctxOf, makeWorkspace, PKG, skipReason, venvEnv } from "./pyfixture.ts";

const root = makeWorkspace(PKG);
const sc = new Sidecar({ root, env: venvEnv() });
const tools = Object.fromEntries(catalog("L", { root, sidecar: sc }).map((t) => [t.name, t]));
const run = (name: string, args: unknown) => tools[name]!.fn(args, ctxOf(root)) as Promise<any>;
after(() => sc.close());

test("nav tools throw `no sidecar` without a sidecar", async () => {
  const bare = catalog("L", { root }).find((t) => t.name === "outline")!;
  await assert.rejects(bare.fn({ path: "pkg/util.py" }, ctxOf(root)), /no sidecar/);
});

test("outline: python symbols, markdown headings, json and yaml keys", { skip: skipReason }, async () => {
  const py = await run("outline", { path: "pkg/models.py" });
  assert.deepEqual(py.items.map((i: any) => [i.kind, i.symbol]), [
    ["class", "pkg/models.py#Base"],
    ["class", "pkg/models.py#User"],
    ["method", "pkg/models.py#User.__init__"],
    ["method", "pkg/models.py#User.slug"],
    ["method", "pkg/models.py#User.save"],
  ]);
  const save = py.items.find((i: any) => i.symbol.endsWith("save"));
  assert.equal(save.signature, "async def save(self) -> None");
  assert.equal(py.items[1].signature, "class User(Base)");
  assert.deepEqual([save.line, save.endLine], [15, 17]);
  const util = await run("outline", { path: "pkg/util.py" });
  assert.deepEqual(util.items.map((i: any) => i.signature), ["DEFAULT_SEP", "def slugify(text: str, sep: str=DEFAULT_SEP) -> str"]);
  const md = await run("outline", { path: "README.md" });
  assert.deepEqual(md.items.map((i: any) => [i.signature, i.line]), [["# Title", 1], ["## Usage", 9]]);
  const js = await run("outline", { path: "config.json" });
  assert.deepEqual(js.items.map((i: any) => [i.symbol, i.line]), [["config.json#name", 2], ["config.json#items", 3], ["config.json#nested", 4]]);
  const ym = await run("outline", { path: "settings.yaml" });
  assert.deepEqual(ym.items.map((i: any) => i.symbol), ["settings.yaml#name", "settings.yaml#items", "settings.yaml#debug"]);
});

test("outline: unsupported language and path containment", { skip: skipReason }, async () => {
  await assert.rejects(run("outline", { path: "app.ts" }), /unsupported language: ts/);
  await assert.rejects(run("outline", { path: "../x.py" }), /path outside workspace/);
  await assert.rejects(run("readSymbol", { symbol: "app.ts#a" }), /unsupported language: ts/);
});

test("readSymbol: source with decorators, nested method, docOnly, not found", { skip: skipReason }, async () => {
  const slug = await run("readSymbol", { symbol: "pkg/models.py#User.slug" });
  assert.equal(slug.source, "    @property\n    def slug(self) -> str:\n        return slugify(self.name)");
  assert.equal(slug.line, 11);
  assert.deepEqual(await run("readSymbol", { symbol: "pkg/models.py#User.save", docOnly: true }), { symbol: "pkg/models.py#User.save", doc: "Persist." });
  assert.match((await run("readSymbol", { symbol: "pkg/util.py#DEFAULT_SEP" })).source, /DEFAULT_SEP = "-"/);
  await assert.rejects(run("readSymbol", { symbol: "pkg/models.py#User.nope" }), /symbol not found/);
  await assert.rejects(run("readSymbol", { symbol: "nohash" }), /path#Name/);
});

test("findDefinition resolves through imports", { skip: skipReason }, async () => {
  const byName = await run("findDefinition", { path: "pkg/views.py", name: "slugify", line: 5 });
  assert.equal(byName.definitions[0].symbol, "pkg/util.py#slugify");
  assert.deepEqual([byName.definitions[0].line, byName.definitions[0].col], [4, 5]);
  const byPos = await run("findDefinition", { path: "pkg/views.py", line: 4, col: 13 });
  assert.equal(byPos.definitions[0].symbol, "pkg/models.py#User");
  const lib = await run("findDefinition", { path: "pkg/models.py", name: "print" });
  assert.equal(lib.definitions[0].path, undefined);
  assert.equal(lib.definitions[0].module, "builtins");
});

test("findReferences: usages across modules with context; definition flagged", { skip: skipReason }, async () => {
  const r = await run("findReferences", { symbol: "pkg/util.py#slugify" });
  const where = r.references.map((x: any) => `${x.path}:${x.line}`);
  for (const w of ["pkg/util.py:4", "pkg/models.py:1", "pkg/models.py:13", "pkg/models.py:17", "pkg/views.py:2", "pkg/views.py:5", "pkg/__init__.py:1"]) assert.ok(where.includes(w), `${w} in ${where}`);
  const use = r.references.find((x: any) => x.path === "pkg/views.py" && x.line === 5);
  assert.equal(use.context, "return slugify(u.name)");
  assert.equal(r.references.find((x: any) => x.path === "pkg/util.py" && x.line === 4).definition, true);
  assert.equal(tools.findReferences!.meta.whenNotToUse!.includes("callGraph"), true);
});

test("findReferences caps long lists with a truncated hint", { skip: skipReason }, async () => {
  const big = makeWorkspace({ "m.py": "def f():\n    pass\n\n" + Array.from({ length: 80 }, () => "f()").join("\n") + "\n" });
  const sc2 = new Sidecar({ root: big, env: venvEnv() });
  try {
    const t = catalog("L", { root: big, sidecar: sc2 }).find((x) => x.name === "findReferences")!;
    const r: any = await t.fn({ path: "m.py", name: "f" }, ctxOf(big));
    assert.ok(r.references.length <= 40);
    assert.match(r.truncated, /showing \d+ of 81/);
  } finally { sc2.close(); }
});

test("signature: annotations, docstring, inferred types", { skip: skipReason }, async () => {
  const s = await run("signature", { symbol: "pkg/util.py#slugify" });
  assert.equal(s.signature, "slugify(text: str, sep: str=DEFAULT_SEP) -> str");
  assert.match(s.docstring, /Make a slug\./);
  assert.equal(s.symbol, "pkg/util.py#slugify");
  const c = await run("signature", { path: "pkg/views.py", name: "User", line: 4 });
  assert.match(c.signature, /User\(name: str\)/);
});
