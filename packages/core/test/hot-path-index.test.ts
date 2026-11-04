import test from "node:test";
import assert from "node:assert/strict";
import { HotPathIndex } from "../src/orchestrate/hot-paths/index.ts";
import type { HotPathSnippet } from "../src/orchestrate/hot-paths/types.ts";
import type { ToolDecl } from "../src/registry/types.ts";
import type { Selection } from "../src/orchestrate/selection/index.ts";

const decl = (name: string, requires: string[] = [], routing: ToolDecl["routing"] = "routed"): ToolDecl => ({
  name, hostName: name, description: name, parameters: {}, returns: "string", routing, capsOutput: true,
  meta: { whenToUse: name, effect: "read", requires },
});
const snippet = (id: string, tools = [id], description = "recover missing"): HotPathSnippet => ({
  id, tools, description, outcome: "not-found", code: "async (tools, state) => { return 1; }",
});
const empty = (): Selection => ({ tools: [], stages: { retrieved: [], reranked: [], final: [] } });

test("description-only BM25 ranking is deterministic, positive, bounded and nonmutating", () => {
  const index = new HotPathIndex([snippet("c"), snippet("b"), snippet("a")]);
  const catalog = [decl("a"), decl("b"), decl("c")];
  const selection = empty();
  const result = index.select("recover missing", selection, catalog);
  assert.deepEqual(result.hotPaths.map(s => s.id), ["a", "b"]);
  assert.deepEqual(result.selection.stages.final, ["a", "b"]);
  assert.deepEqual(selection, empty());
  assert.deepEqual(index.select("c", selection, catalog).hotPaths, [], "ids are not indexed");
  assert.deepEqual(index.select("unmatched", selection, catalog).hotPaths, []);
  assert.deepEqual(index.select("recover", selection, catalog, []).hotPaths, []);
  assert.deepEqual(index.select("recover", selection, catalog, ["a"]).hotPaths, []);
});

test("missing/nonrouted declared tools and requirements are skipped before snippet cap", () => {
  const index = new HotPathIndex([snippet("a", ["missing"]), snippet("b", ["b"]), snippet("c", ["c"]), snippet("d", ["d"])]);
  const b = decl("b"); b.routing = "direct" as ToolDecl["routing"];
  const result = index.select("recover", empty(), [b, decl("c", ["missing"]), decl("d")]);
  assert.deepEqual(result.hotPaths.map(s => s.id), ["d"]);
  const hidden = decl("hidden"); hidden.routing = "direct" as ToolDecl["routing"];
  assert.deepEqual(new HotPathIndex([snippet("c")]).select("recover", empty(), [decl("c", ["hidden"]), hidden]).hotPaths, []);
});

test("six newly added tools includes dependencies, dedupes, and preserves one-level completion", () => {
  const catalog = [decl("a", ["b", "c", "d", "e", "f"]), decl("b", ["deep"]), ...["c", "d", "e", "f", "g", "deep"].map(n => decl(n))];
  const index = new HotPathIndex([snippet("a"), snippet("g")]);
  const result = index.select("recover", empty(), catalog);
  assert.deepEqual(result.selection.stages.final, ["a", "b", "c", "d", "e", "f"]);
  assert.deepEqual(result.hotPaths.map(s => s.id), ["a"]);
  const selected: Selection = { tools: [catalog[0]], stages: { retrieved: [{name:"a",score:9}], final:["a"] } };
  const other = index.select("recover", selected, catalog);
  assert.deepEqual(other.hotPaths.map(s => s.id), ["a", "g"]);
  assert.deepEqual(other.selection.stages.retrieved, selected.stages.retrieved);
  assert.equal(other.selection.tools.filter(t => t.name === "a").length, 1);
});

test("catalog rejects duplicate ids, oversized snippets and empty tool declarations", () => {
  assert.throws(() => new HotPathIndex([snippet("a"), snippet("a")]));
  assert.throws(() => new HotPathIndex([{ ...snippet("a"), code: Array(26).fill("x").join("\n") }]));
  assert.throws(() => new HotPathIndex([snippet("a", [])]));
});

test("reviewed catalog fingerprint covers every hidden field and is order-stable", async () => {
  const { hotPathCatalogFingerprint } = await import("../src/orchestrate/hot-paths/fingerprint.ts");
  const a = snippet("a"), b = snippet("b");
  const original = hotPathCatalogFingerprint([a, b]);
  assert.equal(original, hotPathCatalogFingerprint([b, a]));
  for (const update of [{ id: "changed" }, { description: "changed" }, { outcome: "changed" }, { tools: ["differentTool"] }, { code: "async (tools) => 2" }]) {
    assert.notEqual(original, hotPathCatalogFingerprint([{ ...a, ...update }, b]));
  }
  assert.notEqual(original, hotPathCatalogFingerprint([a]));
});
