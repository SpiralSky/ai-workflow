import assert from "node:assert/strict";
import { test } from "node:test";
import { catalog, toHostDecl } from "../src/index.ts";

const tools = catalog("S", { root: "/tmp" });

test("S order and unique names", () => {
  assert.deepEqual(tools.map((t) => t.name), ["bash", "readFile", "writeFile", "edit", "grep", "findFiles"]);
  assert.equal(new Set(tools.map((t) => t.name)).size, tools.length);
});

test("tier L is not built", () => {
  assert.throws(() => catalog("L", { root: "/tmp" }), /tier L not built yet/);
});

test("length budgets (I-04) and meta filled", () => {
  for (const t of tools) {
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

test("measured S schema size", () => {
  const chars = tools.map((t) => JSON.stringify({ name: t.name, description: t.description, parameters: t.parameters }).length).reduce((a, b) => a + b, 0);
  console.log(`tier S schema: ${chars} chars ~ ${Math.round(chars / 4)} tokens`);
  assert.ok(chars > 0);
});
