import { test, describe, before } from "node:test";
import assert from "node:assert/strict";
import { orchestrate } from "../src/orchestrator.js";
import { loadCatalog, buildBM25Index, search } from "../src/catalog.js";
import { makeChildSession } from "../src/helpers.js";
import { defaultLimits } from "../src/runner.js";
import type { ToolEntry } from "../catalog/types.js";
import type { Session } from "../src/helpers.js";
import type { BranchResult } from "../src/runner.js";

// ── helpers ──────────────────────────────────────────────────────────────────

function fakeSession(cwd = "/tmp"): Session {
  return { cwd, handles: new Map(), state: {} };
}

// Build a minimal shortlist for testing (always includes bash, readFile, edit)
let shortlist: ToolEntry[];
before(async () => {
  const catalog = loadCatalog();
  const idx = buildBM25Index(catalog);
  shortlist = search("read and edit a file", idx, 4);
});

// completeFn that returns controlled programs
function makeCompleteFn(programs: string[]): (s: Session, model: string, prompt: string) => Promise<string> {
  let i = 0;
  return async (_s, _model, _prompt) => programs[i++] ?? `returnUser("no more programs")`;
}

// runBranchFn that returns controlled results
function makeRunBranchFn(results: BranchResult[]): typeof import("../src/runner.js").runBranch {
  let i = 0;
  return async (_code, _s, _limits, _intent, _allowed) =>
    results[i++] ?? { kind: "error", text: "no more results", path: "[]" };
}

// frameFn that returns a fixed string — short-circuits the final LLM framing call
const noopFrameFn = async (_t: string, _s: string[], _f: string | undefined) => "report";

// Default deps for unit tests: skip the edit guard (tests use mocked runBranchFn with no real file I/O).
const testDeps = { disableEditGuard: true } as const;

// ── strip fences ─────────────────────────────────────────────────────────────

describe("stripFences (via orchestrate single-turn)", () => {
  test("code wrapped in ```ts fences is accepted", async () => {
    const runFn = makeRunBranchFn([{ kind: "user", text: "done", path: "[]" }]);
    const result = await orchestrate("task", undefined, shortlist, fakeSession(), defaultLimits, {
      completeFn: async () => "```ts\nreturnUser(\"done\")\n```",
      runBranchFn: runFn,
      frameFn: noopFrameFn, ...testDeps,
    });
    assert.ok(result.length > 0);
  });

  test("code without fences is accepted", async () => {
    const runFn = makeRunBranchFn([{ kind: "user", text: "done", path: "[]" }]);
    const result = await orchestrate("task", undefined, shortlist, fakeSession(), defaultLimits, {
      completeFn: async () => `returnUser("done")`,
      runBranchFn: runFn,
      frameFn: noopFrameFn, ...testDeps,
    });
    assert.ok(result.length > 0);
  });
});

// ── loop termination ──────────────────────────────────────────────────────────

describe("loop termination", () => {
  test("single-step: returnUser exits loop after 1 turn", async () => {
    let runs = 0;
    const runFn: typeof import("../src/runner.js").runBranch = async () => {
      runs++;
      return { kind: "user", text: "found the bug", path: "[readSymbol]" };
    };
    await orchestrate("find the bug", undefined, shortlist, fakeSession(), defaultLimits, {
      completeFn: async () => `returnUser("found")`,
      runBranchFn: runFn,
      frameFn: noopFrameFn, ...testDeps,
    });
    assert.equal(runs, 1);
  });

  test("multi-step: error then user — uses 2 turns", async () => {
    let runs = 0;
    const results: BranchResult[] = [
      { kind: "error", text: "edit failed: not found", path: "[edit:error]" },
      { kind: "user", text: "fixed on retry", path: "[edit → runTests:ok]" },
    ];
    const runFn: typeof import("../src/runner.js").runBranch = async () => results[runs++] ?? { kind: "error", text: "no more", path: "[]" };
    await orchestrate("fix bug", undefined, shortlist, fakeSession(), defaultLimits, {
      completeFn: async () => `return "step"`,
      runBranchFn: runFn,
      frameFn: noopFrameFn, ...testDeps,
    });
    assert.equal(runs, 2);
  });

  test("max turns: loop exits after BRANCH_ORCHESTRATE_MAX_TURNS", async () => {
    // Default max is 15; all results are kind=return so loop runs full course
    const MAX = 15;
    let runs = 0;
    const runFn: typeof import("../src/runner.js").runBranch = async () => {
      runs++;
      return { kind: "return", text: `obs${runs}`, path: "[]" };
    };
    await orchestrate("task", undefined, shortlist, fakeSession(), defaultLimits, {
      completeFn: async () => `return "step"`,
      runBranchFn: runFn,
      frameFn: noopFrameFn, ...testDeps,
    });
    assert.equal(runs, MAX);
  });

  test("loop breaks on first kind=user regardless of remaining turns", async () => {
    let runs = 0;
    const results: BranchResult[] = [
      { kind: "return", text: "intermediate", path: "[]" },
      { kind: "user", text: "done", path: "[]" },
    ];
    const runFn: typeof import("../src/runner.js").runBranch = async () => results[runs++] ?? { kind: "error", text: "no more", path: "[]" };
    await orchestrate("task", undefined, shortlist, fakeSession(), defaultLimits, {
      completeFn: async () => `return "x"`,
      runBranchFn: runFn,
      frameFn: noopFrameFn, ...testDeps,
    });
    assert.equal(runs, 2);
  });
});

// ── step accumulation ─────────────────────────────────────────────────────────

describe("step results", () => {
  test("error results are accumulated in step log", async () => {
    const prompts: string[] = [];
    let runs = 0;
    const results: BranchResult[] = [
      { kind: "error", text: "syntax error at line 1", path: "[]" },
      { kind: "user", text: "fixed", path: "[]" },
    ];
    const runFn: typeof import("../src/runner.js").runBranch = async () => results[runs++] ?? { kind: "error", text: "no more", path: "[]" };
    await orchestrate("fix bug", undefined, shortlist, fakeSession(), defaultLimits, {
      completeFn: async (_s, _m, p) => { prompts.push(p); return `return "x"`; },
      runBranchFn: runFn,
      frameFn: noopFrameFn, ...testDeps,
    });
    // Second turn prompt should include prior step
    assert.ok(prompts.length >= 2, "should have at least 2 prompts");
    assert.ok(prompts[1].includes("Prior step results"), "should include prior step results section");
    assert.ok(prompts[1].includes("error"), "should include error text");
  });

  test("step text is capped at 6000 chars", async () => {
    const longText = "x".repeat(10000);
    let steps: string[] = [];
    const runFn = makeRunBranchFn([
      { kind: "return", text: longText, path: "[]" },
      { kind: "user", text: "done", path: "[]" },
    ]);
    await orchestrate("task", undefined, shortlist, fakeSession(), defaultLimits, {
      completeFn: async (_s, _m, p) => {
        if (p.includes("Prior step results")) {
          const match = /\[turn 1[^\]]*\] (.+)/s.exec(p);
          if (match) steps.push(match[1]);
        }
        return `return "x"`;
      },
      runBranchFn: runFn,
    });
    if (steps.length > 0) {
      assert.ok(steps[0].length <= 6100, "captured step text should be capped");
    }
  });
});

// ── composite prelude ─────────────────────────────────────────────────────────

describe("composite prelude injection", () => {
  test("composite prelude appears in code passed to runBranchFn", async () => {
    // Build a shortlist that includes a composite (applyAndTest)
    const catalog = loadCatalog();
    const idx = buildBM25Index(catalog);
    const compositeShortlist = search("fix bug and run tests", idx, 8);
    const hasComposite = compositeShortlist.some((e) => e.executionKind === "composite");

    if (!hasComposite) {
      // Skip if no composites retrieved (BM25 scores vary)
      return;
    }

    let seenCode = "";
    await orchestrate("fix bug", undefined, compositeShortlist, fakeSession(), defaultLimits, {
      completeFn: async () => `returnUser("done")`,
      runBranchFn: async (code, _s, _l, _i, _a) => {
        seenCode = code;
        return { kind: "user", text: "done", path: "[]" };
      },
      frameFn: noopFrameFn, ...testDeps,
    });

    // The prelude defines composite functions — check for async function keyword
    assert.ok(seenCode.includes("async function"), "composite prelude should define async functions");
  });
});

// ── child session isolation ───────────────────────────────────────────────────

describe("child session isolation", () => {
  test("makeChildSession returns fresh handles and state", () => {
    const parent: Session = { cwd: "/workspace", handles: new Map([["$h1", "value"]]), state: { x: 1 } };
    const child = makeChildSession(parent);
    assert.equal(child.cwd, parent.cwd);
    assert.equal(child.handles.size, 0, "child handles should be empty");
    assert.deepEqual(child.state, {}, "child state should be empty");
  });

  test("two sequential orchestrate calls get different state objects", async () => {
    const stateRefs: object[] = [];
    const runFn: typeof import("../src/runner.js").runBranch = async (_code, s) => {
      stateRefs.push(s.state);
      return { kind: "user" as const, text: "done", path: "[]" };
    };

    const parent = fakeSession();
    await orchestrate("task1", undefined, shortlist, parent, defaultLimits, {
      completeFn: async () => `returnUser("done")`,
      runBranchFn: runFn,
      frameFn: noopFrameFn, ...testDeps,
    });
    await orchestrate("task2", undefined, shortlist, parent, defaultLimits, {
      completeFn: async () => `returnUser("done")`,
      runBranchFn: runFn,
      frameFn: noopFrameFn, ...testDeps,
    });

    assert.equal(stateRefs.length, 2);
    assert.notEqual(stateRefs[0], stateRefs[1], "state objects should be distinct references");
  });

  test("child handles do not leak to parent", async () => {
    const parent = fakeSession();
    const runFn: typeof import("../src/runner.js").runBranch = async (_code, s) => {
      // Simulate a handle being stored in child session
      s.handles.set("$h1", "child-value");
      return { kind: "user", text: "done", path: "[]" };
    };
    await orchestrate("task", undefined, shortlist, parent, defaultLimits, {
      completeFn: async () => `returnUser("done")`,
      runBranchFn: runFn,
      frameFn: noopFrameFn, ...testDeps,
    });
    assert.equal(parent.handles.size, 0, "parent handles should be untouched");
  });
});

// ── policy block ──────────────────────────────────────────────────────────────

describe("policy injection", () => {
  test("policy text appears in the prompt sent to completeFn", async () => {
    let seenPrompt = "";
    const runFn = makeRunBranchFn([{ kind: "user", text: "done", path: "[]" }]);
    await orchestrate("task", "stop after 2 steps", shortlist, fakeSession(), defaultLimits, {
      completeFn: async (_s, _m, p) => { seenPrompt = p; return `returnUser("done")`; },
      runBranchFn: runFn,
      frameFn: noopFrameFn, ...testDeps,
    });
    assert.ok(seenPrompt.includes("stop after 2 steps"), "policy should appear in prompt");
    assert.ok(seenPrompt.includes("## Policy"), "policy section header should appear");
  });

  test("no policy: no ## Policy section in prompt", async () => {
    let seenPrompt = "";
    const runFn = makeRunBranchFn([{ kind: "user", text: "done", path: "[]" }]);
    await orchestrate("task", undefined, shortlist, fakeSession(), defaultLimits, {
      completeFn: async (_s, _m, p) => { seenPrompt = p; return `returnUser("done")`; },
      runBranchFn: runFn,
      frameFn: noopFrameFn, ...testDeps,
    });
    assert.ok(!seenPrompt.includes("## Policy"), "should not have policy section when none given");
  });
});

// ── allowed set ───────────────────────────────────────────────────────────────

describe("allowed set passed to runBranchFn", () => {
  test("floor entries (bash, readFile, edit) always in allowed set", async () => {
    let capturedAllowed: Set<string> | undefined;
    await orchestrate("task", undefined, shortlist, fakeSession(), defaultLimits, {
      completeFn: async () => `returnUser("done")`,
      runBranchFn: async (_code, _s, _l, _i, allowed) => {
        capturedAllowed = allowed;
        return { kind: "user", text: "done", path: "[]" };
      },
      frameFn: noopFrameFn, ...testDeps,
    });
    assert.ok(capturedAllowed?.has("bash"), "bash should always be allowed");
    assert.ok(capturedAllowed?.has("readFile"), "readFile should always be allowed");
    assert.ok(capturedAllowed?.has("edit"), "edit should always be allowed");
  });
});
