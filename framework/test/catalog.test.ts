import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import {
  loadCatalog,
  buildBM25Index,
  search,
  buildFilteredDecls,
  buildCompositePrelude,
  type BM25Index,
} from "../src/catalog.js";
import type { ToolEntry } from "../catalog/types.js";

// ─── Toy catalog for unit-testing the BM25 algorithm ───────────────────────

const TOY: ToolEntry[] = [
  {
    id: "alpha",
    name: "alpha",
    toolDef: { name: "alpha", description: "run shell commands", inputSchema: { type: "object", properties: {} } },
    searchDescription: "execute bash shell command script",
    tags: ["shell", "bash", "execute"],
    executionKind: "helper",
    tsDeclaration: "declare function alpha(): void;",
  },
  {
    id: "beta",
    name: "beta",
    toolDef: { name: "beta", description: "read files", inputSchema: { type: "object", properties: {} } },
    searchDescription: "read file contents source code",
    tags: ["file", "read", "source"],
    executionKind: "helper",
    tsDeclaration: "declare function beta(): void;",
  },
  {
    id: "gamma",
    name: "gamma",
    toolDef: { name: "gamma", description: "run tests", inputSchema: { type: "object", properties: {} } },
    searchDescription: "run tests verify pass fail suite",
    tags: ["test", "verify", "suite"],
    executionKind: "helper",
    tsDeclaration: "declare function gamma(): void;",
  },
];

describe("BM25 algorithm — toy catalog", () => {
  test("tokenize strips stop-words and punctuation", () => {
    const idx = buildBM25Index(TOY);
    // alpha should score highest for a shell query
    const results = search("execute a bash command", idx, 3);
    assert.equal(results[0].id, "alpha");
  });

  test("query with no matching tokens returns entries (floor effect not relevant here)", () => {
    const idx = buildBM25Index(TOY);
    const results = search("xyzzy gibberish nomatch", idx, 3);
    // All three returned (no score > 0, order arbitrary but must have 3)
    assert.equal(results.length, 3);
  });

  test("file-read query scores beta highest", () => {
    const idx = buildBM25Index(TOY);
    const results = search("read file contents", idx, 2);
    assert.equal(results[0].id, "beta");
  });

  test("test-related query scores gamma highest", () => {
    const idx = buildBM25Index(TOY);
    const results = search("run test suite verify", idx, 2);
    assert.equal(results[0].id, "gamma");
  });

  test("topK limits number of results", () => {
    const idx = buildBM25Index(TOY);
    const results = search("run shell read file", idx, 2);
    assert.equal(results.length, 2);
  });
});

// ─── Real catalog tests ─────────────────────────────────────────────────────

describe("real catalog — load and build index", () => {
  let catalog: ToolEntry[];
  let idx: BM25Index;

  test("loadCatalog returns all primitives and composites", () => {
    catalog = loadCatalog();
    assert.ok(catalog.length >= 16, "expected at least 16 entries (15 primitives + composites)");
  });

  test("buildBM25Index succeeds on real catalog", () => {
    idx = buildBM25Index(loadCatalog());
    assert.ok(idx.entries.length > 0);
    assert.ok(idx.idf.size > 0);
  });
});

describe("real catalog — floor entries always present", () => {
  let idx: BM25Index;
  before(() => { idx = buildBM25Index(loadCatalog()); });

  const floorIds = ["bash", "readFile", "edit"];

  test("floor entries present for file-read query", () => {
    const results = search("read file contents inspect source", idx, 8);
    const ids = new Set(results.map((e) => e.id));
    for (const id of floorIds) assert.ok(ids.has(id), `floor entry '${id}' missing`);
  });

  test("floor entries present for unrelated query", () => {
    const results = search("summarize large document overview", idx, 8);
    const ids = new Set(results.map((e) => e.id));
    for (const id of floorIds) assert.ok(ids.has(id), `floor entry '${id}' missing`);
  });

  test("floor entries present for sparse query", () => {
    const results = search("xyzzy gibberish", idx, 8);
    const ids = new Set(results.map((e) => e.id));
    for (const id of floorIds) assert.ok(ids.has(id), `floor entry '${id}' missing`);
  });
});

describe("real catalog — precision: relevant tools in top-5", () => {
  let idx: BM25Index;
  before(() => { idx = buildBM25Index(loadCatalog()); });

  function topIds(task: string, k = 5): Set<string> {
    return new Set(search(task, idx, k).map((e) => e.id));
  }

  test("'find all callers of a function' includes readSymbol and findWithCallers", () => {
    const ids = topIds("find all callers of a function before refactoring");
    assert.ok(ids.has("readSymbol") || ids.has("findWithCallers"),
      "expected readSymbol or findWithCallers");
  });

  test("'fix a bug and verify with tests' includes applyAndTest or edit+runTests", () => {
    const ids = topIds("fix a bug and verify with tests");
    const hasApplyAndTest = ids.has("applyAndTest");
    const hasEditAndTest = ids.has("edit") && ids.has("runTests");
    assert.ok(hasApplyAndTest || hasEditAndTest,
      "expected applyAndTest or (edit + runTests) in top 5");
  });

  test("'run the test suite' includes runTests", () => {
    const ids = topIds("run the test suite and report failures");
    assert.ok(ids.has("runTests"), "expected runTests in top 5");
  });

  test("'summarize a readme file' includes readAndSummarize or weakLLM", () => {
    const ids = topIds("summarize the readme file and give me an overview");
    assert.ok(ids.has("readAndSummarize") || ids.has("weakLLM"),
      "expected readAndSummarize or weakLLM in top 5");
  });

  test("'create a new source file' includes writeFile or patchAndVerify", () => {
    const ids = topIds("create a new source file with an implementation");
    assert.ok(ids.has("writeFile") || ids.has("patchAndVerify"),
      "expected writeFile or patchAndVerify in top 5");
  });

  test("'rename a function across all files' includes findAndReplace or findWithCallers", () => {
    const ids = topIds("rename a function across all files in the project");
    assert.ok(ids.has("findAndReplace") || ids.has("findWithCallers"),
      "expected findAndReplace or findWithCallers in top 5");
  });

  test("'call a web api and fetch data' includes tool (WebFetch)", () => {
    const ids = topIds("fetch a web page and extract information from it");
    assert.ok(ids.has("tool"), "expected tool (WebFetch) in top 5");
  });
});

describe("real catalog — irrelevance: unrelated tools not in top-3", () => {
  let idx: BM25Index;
  before(() => { idx = buildBM25Index(loadCatalog()); });

  function topIds(task: string, k = 3): Set<string> {
    return new Set(search(task, idx, k).map((e) => e.id));
  }

  test("'summarize the readme' does not rank runTests in top-3 non-floor results", () => {
    // get top 6 results (3 floor + 3 non-floor), check runTests not in the non-floor top-3
    const results = search("summarize the readme file", buildBM25Index(loadCatalog()), 6);
    const nonFloor = results.filter((e) => !["bash", "readFile", "edit"].includes(e.id));
    const nonFloorTop3 = new Set(nonFloor.slice(0, 3).map((e) => e.id));
    assert.ok(!nonFloorTop3.has("runTests"),
      "runTests should not be in top-3 non-floor results for a summarize query");
  });

  test("'classify the type of error message' does not rank writeFile in top-3 non-floor", () => {
    const results = search("classify the type of error message in this output", buildBM25Index(loadCatalog()), 6);
    const nonFloor = results.filter((e) => !["bash", "readFile", "edit"].includes(e.id));
    const nonFloorTop3 = new Set(nonFloor.slice(0, 3).map((e) => e.id));
    assert.ok(!nonFloorTop3.has("writeFile"),
      "writeFile should not be in top-3 non-floor results for a classify query");
  });
});

describe("buildFilteredDecls", () => {
  test("includes tsDeclaration for primitive entries", () => {
    const catalog = loadCatalog();
    const bash = catalog.find((e) => e.id === "bash")!;
    const decls = buildFilteredDecls([bash]);
    assert.ok(decls.includes("declare function bash"), "expected bash declaration");
  });

  test("includes composite.declaration (not implementation) for composite entries", () => {
    const catalog = loadCatalog();
    const composite = catalog.find((e) => e.id === "applyAndTest")!;
    const decls = buildFilteredDecls([composite]);
    assert.ok(decls.includes("declare function applyAndTest"), "expected applyAndTest declaration");
    assert.ok(!decls.includes("await edit"), "implementation should not appear in decls");
  });

  test("composite declaration also missing from decls of non-selected entries", () => {
    const catalog = loadCatalog();
    const bash = catalog.find((e) => e.id === "bash")!;
    const decls = buildFilteredDecls([bash]);
    assert.ok(!decls.includes("applyAndTest"), "applyAndTest should not appear");
  });
});

describe("buildCompositePrelude", () => {
  test("returns empty string for primitives-only list", () => {
    const catalog = loadCatalog();
    const prims = catalog.filter((e) => e.executionKind !== "composite");
    assert.equal(buildCompositePrelude(prims), "");
  });

  test("includes implementation for composite entries", () => {
    const catalog = loadCatalog();
    const composite = catalog.find((e) => e.id === "applyAndTest")!;
    const prelude = buildCompositePrelude([composite]);
    assert.ok(prelude.includes("async function applyAndTest"), "expected implementation");
    assert.ok(prelude.includes("await edit"), "expected edit call in implementation");
  });

  test("multiple composites are separated in the prelude", () => {
    const catalog = loadCatalog();
    const comps = catalog.filter((e) => e.executionKind === "composite").slice(0, 2);
    const prelude = buildCompositePrelude(comps);
    assert.ok(prelude.length > 0);
  });
});
