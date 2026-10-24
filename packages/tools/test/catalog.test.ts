import assert from "node:assert/strict";
import { test } from "node:test";
import { catalog, toHostDecl } from "../src/index.ts";

const tools = catalog("S", { root: "/tmp" });
const partialL = catalog("L", { root: "/tmp", partial: true });

test("S order and unique names", () => {
  assert.deepEqual(tools.map((t) => t.name), ["bash", "readFile", "writeFile", "edit", "grep", "findFiles"]);
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
});

test("tier L is not built", () => {
  assert.throws(() => catalog("L", { root: "/tmp" }), /tier L not built yet/);
});

test("L partial: S objects unchanged, unique names, fs, nav, graph, refactor, check, vcs, external groups", () => {
  assert.deepEqual(partialL.slice(0, 6), tools);
  partialL.slice(0, 6).forEach((t, i) => assert.equal(t, tools[i]));
  assert.equal(new Set(partialL.map((t) => t.name)).size, partialL.length);
  assert.equal(partialL.length, 6 + 4 + 5 + 5 + 8 + 2 + 3 + 14);
  assert.deepEqual(partialL.slice(6, 33).map((t) => t.name), [
    "multiEdit", "moveFile", "deleteFile", "listDir",
    "outline", "readSymbol", "findDefinition", "findReferences", "signature",
    "overview", "callGraph", "importGraph", "impact", "dataFlow",
    "renameSymbol", "moveSymbol", "moveModule", "extractFunction", "inlineSymbol", "changeSignature", "extractVariable", "organizeImports",
    "check", "format",
    "diff", "history", "restore",
  ]);
  const external = partialL.filter((t) => t.meta.category === "external");
  assert.equal(external.length, 14);
  assert.ok(external.every((t) => t.meta.effect === "external"));
});

test("length budgets (I-04) and meta filled", () => {
  for (const t of partialL) {
    assert.ok(t.description.length <= 200, `${t.name} description`);
    assert.ok(t.meta.whenToUse.length > 0 && t.meta.whenToUse.length <= 200, `${t.name} whenToUse`);
    const props = (t.parameters as { properties: Record<string, { description?: string }> }).properties;
    for (const [k, v] of Object.entries(props)) {
      assert.ok(v.description && v.description.length <= 80, `${t.name}.${k} doc`);
    }
    assert.ok(t.meta.examples.length > 0, `${t.name} examples`);
    assert.ok(t.meta.category, `${t.name} category`);
    assert.ok(["read", "exec", "write", "external"].includes(t.meta.effect));
    assert.ok(Array.isArray(t.meta.requires));
    assert.equal(typeof t.meta.cost, "number");
    assert.ok(t.returns, `${t.name} returns`);
    assert.ok(t.meta.whenNotToUse, `${t.name} whenNotToUse`);
    assert.equal(toHostDecl(t).capsOutput, false);
  }
});

test("refactor tools: cross-references in whenNotToUse, all write tools", () => {
  const by = Object.fromEntries(partialL.map((t) => [t.name, t]));
  assert.match(by.renameSymbol!.meta.whenNotToUse!, /\bedit\b/);
  assert.match(by.moveModule!.meta.whenNotToUse!, /moveFile/);
  assert.match(by.moveFile!.meta.whenNotToUse!, /moveModule/);
  const refactor = partialL.filter((t) => t.meta.category === "refactor");
  assert.equal(refactor.length, 8);
  assert.ok(refactor.every((t) => t.meta.effect === "write"));
  assert.ok(refactor.every((t) => "dryRun" in (t.parameters as { properties: object }).properties));
});

test("measured S schema size", () => {
  const chars = tools.map((t) => JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }).length).reduce((a, b) => a + b, 0);
  console.log(`tier S schema: ${chars} chars ~ ${Math.round(chars / 4)} tokens`);
  assert.ok(chars > 0);
  const size = (ts: typeof partialL) => ts.map((t) => JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }).length).reduce((a, b) => a + b, 0);
  const l = size(partialL);
  console.log(`tier L partial (${partialL.length} tools, fs+nav+graph+refactor+check+vcs+external): ${l} chars ~ ${Math.round(l / 4)} tokens`);
});
