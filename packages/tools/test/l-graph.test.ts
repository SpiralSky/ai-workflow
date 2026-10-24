import assert from "node:assert/strict";
import { after, test } from "node:test";
import { catalog, Sidecar } from "../src/index.ts";
import { ctxOf, GRAPH_PKG, makeWorkspace, skipReason, venvEnv } from "./pyfixture.ts";
import { writeFileSync, utimesSync } from "node:fs";
import { join } from "node:path";

const root = makeWorkspace(GRAPH_PKG);
const sc = new Sidecar({ root, env: venvEnv() });
const tools = Object.fromEntries(catalog("L", { root, sidecar: sc }).map((t) => [t.name, t]));
const run = (name: string, args: unknown) => tools[name]!.fn(args, ctxOf(root)) as Promise<any>;
after(() => sc.close());

const SAVE = "app/store.py#Store.save";

test("graph tools throw `no sidecar` without a sidecar", async () => {
  const bare = catalog("L", { root }).find((t) => t.name === "callGraph")!;
  await assert.rejects(bare.fn({ symbol: SAVE }, ctxOf(root)), /no sidecar/);
});

test("overview: modules, entry points, public API, hotspots, tests", { skip: skipReason }, async () => {
  const o = await run("overview", {});
  assert.deepEqual(o.modules[0], { path: "app/core.py", symbols: 2, imports: 2, importedBy: 3 });
  assert.ok(!o.modules.some((m: any) => m.path.startsWith("tests/")));
  assert.deepEqual(o.entryPoints.map((e: any) => [e.kind, e.path, e.symbol ?? e.line]), [["main", "app/core.py", 13], ["script", "app/core.py", "app/core.py#main"]]);
  const api = Object.fromEntries(o.publicApi.map((a: any) => [a.path, a]));
  assert.deepEqual(api["app/__init__.py"].names, ["run"]);
  assert.equal(api["app/__init__.py"].via, "__all__");
  assert.deepEqual(api["app/store.py"].names, ["Base", "Store"]);
  assert.equal(o.largest[0].symbol, "app/store.py#Store");
  assert.ok(o.mostConnected.some((m: any) => m.symbol === "app/core.py#run"));
  assert.deepEqual(o.tests, [{ path: "tests/test_core.py", tests: 1, imports: ["app/core.py"] }]);
});

test("callGraph: callers across files with lines, callees, both, depth cap, errors", { skip: skipReason }, async () => {
  const inn = await run("callGraph", { symbol: SAVE, direction: "in", depth: 3 });
  assert.deepEqual(inn.nodes.map((n: any) => [n.symbol, n.depth]), [
    ["app/extra.py#FastStore.save", 1], ["app/store.py#Store.flush", 1], ["app/helpers.py#step", 2], ["app/core.py#run", 3],
  ]);
  assert.ok(inn.edges.some((e: any) => e.from === "app/helpers.py#step" && e.to === "app/store.py#Store.flush" && e.line === 8));
  assert.ok(inn.edges.some((e: any) => e.from === "app/extra.py#FastStore.save" && e.to === SAVE), "super().save() edge");
  const out = await run("callGraph", { symbol: "app/core.py#run", direction: "out" });
  assert.deepEqual(out.nodes.map((n: any) => n.symbol), ["app/helpers.py#step", "app/store.py#Store.__init__", "app/store.py#Store.flush"]);
  const both = await run("callGraph", { symbol: "app/helpers.py#step", depth: 1 });
  assert.deepEqual(both.nodes.map((n: any) => [n.symbol, n.dir]), [["app/core.py#run", "in"], ["app/store.py#Store.flush", "out"]]);
  assert.equal((await run("callGraph", { symbol: SAVE, direction: "in", depth: 99 })).depth, 5);
  await assert.rejects(run("callGraph", { symbol: "app/core.py#nope" }), /symbol not found/);
  await assert.rejects(run("callGraph", { symbol: "app/ui.js#x" }), /unsupported language: js/);
  await assert.rejects(run("callGraph", { symbol: "../x.py#a" }), /path outside workspace/);
  await assert.rejects(run("callGraph", { symbol: SAVE, direction: "up" }), /direction/);
});

test("importGraph: edges, cycle with the closing import line, module filter", { skip: skipReason }, async () => {
  const g = await run("importGraph", {});
  assert.ok(g.edges.some((e: any) => e.from === "app/core.py" && e.to === "app/helpers.py" && e.line === 1));
  assert.deepEqual(g.cycles, [{ modules: ["app/core.py", "app/helpers.py"], closedBy: { path: "app/helpers.py", line: 1 } }]);
  const store = await run("importGraph", { module: "app.store" });
  assert.deepEqual(store.edges.map((e: any) => e.from), ["app/core.py", "app/extra.py", "app/helpers.py"]);
  assert.deepEqual(store.cycles, []);
  const pkg = await run("importGraph", { module: "app" });
  assert.equal(pkg.cycles.length, 1);
  assert.equal((await run("importGraph", { module: "app/helpers.py" })).cycles.length, 1);
  await assert.rejects(run("importGraph", { module: "nope.mod" }), /module not found/);
  await assert.rejects(run("importGraph", { module: "app/ui.js" }), /unsupported language: js/);
});

test("impact: transitive callers, overrides, subclasses, tests", { skip: skipReason }, async () => {
  const i = await run("impact", { symbol: SAVE });
  assert.deepEqual(i.callers.map((c: any) => c.symbol), [
    "app/extra.py#FastStore.save", "app/store.py#Store.flush", "app/helpers.py#step", "app/core.py#run", "app/core.py#main",
  ]);
  assert.deepEqual(i.overrides, ["app/extra.py#FastStore.save"]);
  assert.deepEqual(i.tests, [{ path: "tests/test_core.py", symbol: "tests/test_core.py#test_run", depth: 4, via: "call" }]);
  const cls = await run("impact", { symbol: "app/store.py#Store" });
  assert.deepEqual(cls.subclasses, ["app/extra.py#FastStore"]);
  assert.ok(cls.callers.some((c: any) => c.symbol === "app/core.py#run"), "constructor call");
  const base = await run("impact", { symbol: "app/store.py#Base" });
  assert.deepEqual(base.subclasses, ["app/store.py#Store", "app/extra.py#FastStore"].sort());
  // an import-only test file is listed as such
  const imp = await run("impact", { symbol: "app/core.py#LIMIT" }).catch((e) => e);
  assert.match(String(imp), /symbol not found/);
});

test("dataFlow: attribute writes/reads with thread and async context", { skip: skipReason }, async () => {
  const d = await run("dataFlow", { symbol: "app/store.py#Store.count" });
  const w = Object.fromEntries(d.writes.map((x: any) => [x.in, x]));
  assert.equal(w["app/helpers.py#worker"].context, "thread target");
  assert.equal(w["app/helpers.py#tick"].context, "async def");
  assert.equal(w["app/helpers.py#tick"].kind, "augassign");
  assert.equal(w["app/store.py#Store.save"].context, undefined);
  assert.ok(w["app/extra.py#FastStore.save"], "write through subclass self");
  assert.equal(d.concurrentWrites, 2);
  assert.deepEqual(d.reads.map((r: any) => [r.in, r.line]), [["app/helpers.py#peek", 24]]);
  assert.equal(w["app/store.py#Store.__init__"].line, 8);
});

test("dataFlow: module global, mutation and declarations; errors", { skip: skipReason }, async () => {
  const g = await run("dataFlow", { symbol: "app/helpers.py#TOTAL" });
  assert.deepEqual(g.writes.map((x: any) => [x.in, x.kind, x.context]), [
    ["app/helpers.py#<module>", "assign", undefined], ["app/helpers.py#worker", "augassign", "thread target"],
  ]);
  assert.deepEqual(g.reads.map((x: any) => x.in), ["app/helpers.py#peek"]);
  const items = await run("dataFlow", { symbol: "app/store.py#Store.items" });
  assert.ok(items.writes.some((x: any) => x.kind === "mutate" && x.in === SAVE));
  await assert.rejects(run("dataFlow", { symbol: "app/store.py#Store.nope" }), /attribute not found/);
  await assert.rejects(run("dataFlow", { symbol: "app/core.py#run" }), /takes a variable or attribute/);
  await assert.rejects(run("dataFlow", { symbol: "app/ui.js#x" }), /unsupported language: js/);
});

test("index follows file changes and survives syntax errors", { skip: skipReason }, async () => {
  const ws = makeWorkspace(GRAPH_PKG);
  const sc2 = new Sidecar({ root: ws, env: venvEnv() });
  try {
    const t = catalog("L", { root: ws, sidecar: sc2 }).find((x) => x.name === "callGraph")!;
    const call = (a: unknown) => t.fn(a, ctxOf(ws)) as Promise<any>;
    assert.equal((await call({ symbol: "app/core.py#run", direction: "out", depth: 1 })).nodes.length, 2);
    writeFileSync(join(ws, "app/core.py"), "def run(n):\n    return n\n");
    utimesSync(join(ws, "app/core.py"), new Date(), new Date(Date.now() + 5000));
    assert.equal((await call({ symbol: "app/core.py#run", direction: "out", depth: 1 })).nodes.length, 0);
    writeFileSync(join(ws, "app/broken.py"), "def (:\n");
    const o: any = await (catalog("L", { root: ws, sidecar: sc2 }).find((x) => x.name === "overview")!.fn({}, ctxOf(ws)));
    assert.deepEqual(o.unparsed, ["app/broken.py"]);
  } finally { sc2.close(); }
});

test("duck-typed receiver with two candidate classes: approx edge to each, not one arbitrary pick", { skip: skipReason }, async () => {
  const ws = makeWorkspace({ "m.py": "class A:\n    def go(self): pass\nclass B:\n    def go(self): pass\ndef make(f):\n    return A() if f else B()\ndef use(f):\n    x = make(f)\n    x.go()\n" });
  const sc2 = new Sidecar({ root: ws, env: venvEnv() });
  try {
    const t = catalog("L", { root: ws, sidecar: sc2 }).find((x) => x.name === "callGraph")!;
    const r: any = await t.fn({ symbol: "m.py#use", direction: "out", depth: 1 }, ctxOf(ws));
    const go = r.edges.filter((e: any) => e.to.endsWith(".go"));
    assert.deepEqual(go.map((e: any) => [e.to, e.approx, e.candidates]), [["m.py#A.go", true, 2], ["m.py#B.go", true, 2]]);
  } finally { sc2.close(); }
});

test("caps: long lists carry a truncated hint with the true total; overview stays under 8 KB", { skip: skipReason }, async () => {
  const files: Record<string, string> = { "pkg/__init__.py": "", "pkg/hub.py": "def hub():\n    pass\n" };
  for (let i = 0; i < 70; i++) {
    files[`pkg/m${i}.py`] = `from pkg.hub import hub\n\ndef caller_${i}():\n    hub()\n`;
    files[`tests/test_m${i}.py`] = `from pkg.m${i} import caller_${i}\n\ndef test_${i}():\n    caller_${i}()\n`;
  }
  files["pkg/main.py"] = 'if __name__ == "__main__":\n    pass\n';
  const big = makeWorkspace(files);
  const sc2 = new Sidecar({ root: big, env: venvEnv() });
  try {
    const by = Object.fromEntries(catalog("L", { root: big, sidecar: sc2 }).map((x) => [x.name, x]));
    const go = (n: string, a: unknown) => by[n]!.fn(a, ctxOf(big)) as Promise<any>;
    const cg = await go("callGraph", { symbol: "pkg/hub.py#hub", direction: "in", depth: 1 });
    assert.ok(cg.nodes.length <= 40);
    assert.match(cg.truncated, /nodes: showing \d+ of 70/);
    const im = await go("impact", { symbol: "pkg/hub.py#hub" });
    assert.match(im.truncated, /callers: showing 30 of 70/);
    assert.match(im.truncated, /tests: showing 15 of 70/);
    const ig = await go("importGraph", {});
    assert.match(ig.truncated, /edges: showing \d+ of 140/);
    const ov = await go("overview", {});
    assert.match(ov.truncated, /modules: showing \d+ of 73/);
    assert.ok(JSON.stringify(ov).length < 8192, `overview ${JSON.stringify(ov).length} bytes`);
    assert.equal(ov.tests.length, 10);
  } finally { sc2.close(); }
});
