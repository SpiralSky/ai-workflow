import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { handleDelegate } from "../src/delegate.js";
import type { Session } from "../src/helpers.js";
import type { ToolEntry, BM25Index } from "../src/catalog.js";
import { defaultLimits } from "../src/runner.js";

function fakeSession(): Session {
  return { cwd: "/tmp", handles: new Map(), state: {} };
}

// A minimal BM25Index to satisfy the type (unused in mocked path)
const fakeIndex: BM25Index = { entries: [], idf: new Map(), tf: [], docLens: [], avgLen: 0 };

// ── handleDelegate wiring ─────────────────────────────────────────────────────

describe("handleDelegate", () => {
  test("calls searchFn with the task and passes shortlist to orchestrateFn", async () => {
    const fakeEntry: ToolEntry = {
      id: "bash", name: "bash",
      toolDef: { name: "bash", description: "run shell", inputSchema: { type: "object", properties: {} } },
      searchDescription: "run a shell command", tags: ["bash"], executionKind: "helper",
    };
    let searchedTask = "";
    let receivedShortlist: ToolEntry[] = [];

    const result = await handleDelegate("read the README", undefined, fakeSession(), defaultLimits, {
      getCatalogIndexFn: () => ({ catalog: [fakeEntry], index: fakeIndex }),
      searchFn: (task, _idx, _k) => { searchedTask = task; return [fakeEntry]; },
      orchestrateFn: async (_task, _policy, shortlist) => {
        receivedShortlist = shortlist;
        return "report: README has 3 sections";
      },
    });

    assert.equal(searchedTask, "read the README");
    assert.deepEqual(receivedShortlist, [fakeEntry]);
    assert.equal(result, "report: README has 3 sections");
  });

  test("passes policy to orchestrateFn", async () => {
    let receivedPolicy: string | undefined;
    await handleDelegate("do something", "stop after 2 steps", fakeSession(), defaultLimits, {
      getCatalogIndexFn: () => ({ catalog: [], index: fakeIndex }),
      searchFn: (_t, _i, _k) => [],
      orchestrateFn: async (_task, policy) => { receivedPolicy = policy; return "done"; },
    });
    assert.equal(receivedPolicy, "stop after 2 steps");
  });

  test("passes undefined policy when not provided", async () => {
    let receivedPolicy: string | undefined = "sentinel";
    await handleDelegate("task", undefined, fakeSession(), defaultLimits, {
      getCatalogIndexFn: () => ({ catalog: [], index: fakeIndex }),
      searchFn: () => [],
      orchestrateFn: async (_t, policy) => { receivedPolicy = policy; return "done"; },
    });
    assert.equal(receivedPolicy, undefined);
  });

  test("returns the report string from orchestrateFn", async () => {
    const result = await handleDelegate("task", undefined, fakeSession(), defaultLimits, {
      getCatalogIndexFn: () => ({ catalog: [], index: fakeIndex }),
      searchFn: () => [],
      orchestrateFn: async () => "final report text",
    });
    assert.equal(result, "final report text");
  });

  test("returns error message string when orchestrateFn throws (no propagation)", async () => {
    const result = await handleDelegate("task", undefined, fakeSession(), defaultLimits, {
      getCatalogIndexFn: () => ({ catalog: [], index: fakeIndex }),
      searchFn: () => [],
      orchestrateFn: async () => { throw new Error("connection refused"); },
    });
    assert.ok(result.startsWith("Delegate error:"), `expected error prefix, got: ${result}`);
    assert.ok(result.includes("connection refused"));
  });

  test("returns error message string when getCatalogIndexFn throws", async () => {
    const result = await handleDelegate("task", undefined, fakeSession(), defaultLimits, {
      getCatalogIndexFn: () => { throw new Error("catalog load failed"); },
    });
    assert.ok(result.startsWith("Delegate error:"));
    assert.ok(result.includes("catalog load failed"));
  });

  test("returns error message string when searchFn throws", async () => {
    const result = await handleDelegate("task", undefined, fakeSession(), defaultLimits, {
      getCatalogIndexFn: () => ({ catalog: [], index: fakeIndex }),
      searchFn: () => { throw new Error("index corrupted"); },
    });
    assert.ok(result.startsWith("Delegate error:"));
    assert.ok(result.includes("index corrupted"));
  });

  test("passes session to orchestrateFn", async () => {
    const session = fakeSession();
    let receivedSession: Session | undefined;
    await handleDelegate("task", undefined, session, defaultLimits, {
      getCatalogIndexFn: () => ({ catalog: [], index: fakeIndex }),
      searchFn: () => [],
      orchestrateFn: async (_t, _p, _sl, s) => { receivedSession = s; return "done"; },
    });
    assert.equal(receivedSession, session);
  });

  test("passes limits to orchestrateFn", async () => {
    const limits = { ...defaultLimits, maxCalls: 10 };
    let receivedLimits;
    await handleDelegate("task", undefined, fakeSession(), limits, {
      getCatalogIndexFn: () => ({ catalog: [], index: fakeIndex }),
      searchFn: () => [],
      orchestrateFn: async (_t, _p, _sl, _s, l) => { receivedLimits = l; return "done"; },
    });
    assert.equal(receivedLimits, limits);
  });
});

// ── catalog caching ───────────────────────────────────────────────────────────

describe("catalog caching", () => {
  test("getCatalogIndexFn called once per handleDelegate call", async () => {
    let catalogCalls = 0;
    const deps = {
      getCatalogIndexFn: () => { catalogCalls++; return { catalog: [], index: fakeIndex }; },
      searchFn: () => [] as ToolEntry[],
      orchestrateFn: async () => "done",
    };
    await handleDelegate("t1", undefined, fakeSession(), defaultLimits, deps);
    await handleDelegate("t2", undefined, fakeSession(), defaultLimits, deps);
    // Two calls — the injected fn is called each time (caching is the module-level default)
    assert.equal(catalogCalls, 2);
  });
});

// ── BM25Index type check ──────────────────────────────────────────────────────

describe("BM25Index type", () => {
  test("fakeIndex has the correct shape", () => {
    assert.ok(Array.isArray(fakeIndex.entries));
    assert.ok(fakeIndex.idf instanceof Map);
    assert.equal(typeof fakeIndex.avgLen, "number");
  });
});
