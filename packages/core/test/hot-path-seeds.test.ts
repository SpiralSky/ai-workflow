import test from "node:test";
import assert from "node:assert/strict";
import { compileBranch } from "../src/branch/compile.ts";
import { runBranch } from "../src/branch/run.ts";
import type { BranchTools, State } from "../src/branch/types.ts";
import { HOT_PATH_SEEDS } from "../src/orchestrate/hot-paths/catalog.ts";
import { runtime } from "./engine.ts";

interface ExpectedCall { name: string; args?: Record<string, unknown>; result?: unknown; error?: string }

/** Executes the actual compiled seed against a strict, ordered fake-host script. */
async function execute(id: string, state: State, script: ExpectedCall[]) {
  const seed = HOT_PATH_SEEDS.find((s) => s.id === id);
  assert.ok(seed, `unknown seed ${id}`);
  const compiled = compileBranch(seed.code);
  assert.ok(!("error" in compiled), `${id}: ${JSON.stringify(compiled)}`);
  const calls: { name: string; args: Record<string, unknown> }[] = [];
  const tools: BranchTools = Object.fromEntries(seed.tools.map((name) => [name, (args: Record<string, unknown>) => {
    const expected = script[calls.length];
    calls.push({ name, args });
    assert.ok(expected, `unexpected ${name} call`);
    assert.equal(name, expected.name);
    if (expected.args) assert.deepEqual(args, expected.args);
    if (expected.error) throw new Error(expected.error);
    return expected.result;
  }]));
  const result = await runBranch(compiled, tools, { ...state }, { timeoutMs: 2000 }, runtime);
  assert.equal(calls.length, script.length, `${id}: expected call count`);
  for (const event of result.trace) {
    if (event.type === "call" && event.phase === "start") assert.ok(seed.tools.includes(event.name), `${id}: undeclared ${event.name}`);
  }
  return result;
}

const validInputs: Record<string, State> = {
  "grep-empty-widen": { path: "src", pattern: "needle" },
  "find-files-empty-widen": { path: "src", pattern: "*.py" },
  "read-not-found-locate": { path: "src/module.py" },
  "edit-missing-reread": { path: "src/module.py", old: "before", new: "after" },
  "edit-ambiguous-reread": { path: "src/module.py", old: "before", new: "after" },
  "read-truncated-range": { path: "src/module.py", start: 10, end: 20 },
  "command-nonzero-summary": { cmd: "printf ready" },
  "test-failure-summary": { target: "tests/test_module.py#Checks.test_behavior" },
  "edit-then-narrow-test": { path: "src/module.py", old: "before", new: "after", target: "tests/test_module.py#Checks.test_behavior" },
  "rename-zero-references": { path: "src/module.py", name: "example" },
  "move-cycle-diagnose": { path: "src/module.py", name: "example", to: "src/other.py" },
  "check-errors-read": { path: "src/module.py" },
};

test("hot-path seed catalog is generic, complete and branch-compilable within the line bound", () => {
  assert.equal(HOT_PATH_SEEDS.length, 12);
  assert.equal(new Set(HOT_PATH_SEEDS.map((s) => s.id)).size, HOT_PATH_SEEDS.length);
  assert.deepEqual(HOT_PATH_SEEDS.map((s) => s.id).sort(), Object.keys(validInputs).sort());
  for (const seed of HOT_PATH_SEEDS) {
    assert.ok(seed.description.trim());
    assert.ok(seed.outcome.trim());
    assert.ok(seed.code.trim().split("\n").length <= 25, `${seed.id}: >25 lines`);
    assert.equal(new Set(seed.tools).size, seed.tools.length);
    assert.ok(seed.tools.length > 0);
    assert.ok(!("error" in compileBranch(seed.code)), `${seed.id} compiles`);
  }
});

for (const [id, state] of Object.entries(validInputs)) {
  test(`${id}: missing inputs fail before tool use`, async () => {
    const result = await execute(id, {}, []);
    assert.equal(result.ok, false);
  });
  test(`${id}: every required input is validated before tool use`, async () => {
    for (const key of Object.keys(state)) {
      const missing = { ...state };
      delete missing[key];
      assert.equal((await execute(id, missing, [])).ok, false, `${key} missing`);
      assert.equal((await execute(id, { ...state, [key]: null }, [])).ok, false, `${key} null`);
    }
  });
  test(`${id}: workspace path arguments cannot escape or carry control characters`, async () => {
    for (const key of ["path", "to", "target"].filter((key) => key in state)) {
      for (const value of ["/etc/passwd", "../outside.py", "src/../../outside.py", "C:\\outside.py", "src\\outside.py", "src/\u0000bad.py", "src/\nbad.py"]) {
        assert.equal((await execute(id, { ...state, [key]: value }, [])).ok, false, `${key}: ${JSON.stringify(value)}`);
      }
    }
  });
  test(`${id}: unexpected host errors are not disguised as anticipated outcomes`, async () => {
    const seed = HOT_PATH_SEEDS.find((s) => s.id === id)!;
    const result = await execute(id, state, [{ name: seed.tools[0]!, error: "unexpected host unavailable" }]);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /unexpected host unavailable/);
  });
}

const file = "src/module.py";
const target = "tests/test_module.py#Checks.test_behavior";
const change = { files: [{ path: file, added: 1, removed: 1 }] };
const match = { path: file, line: 4, text: "needle" };
const failure = { id: target, kind: "failure", message: "expected true", location: { path: target.split("#")[0], line: 9 }, excerpt: "assert actual" };
const passing = { passed: 1, skipped: 0, failed: [] };
const failing = { passed: 0, skipped: 0, failed: [failure] };
const editCall = { name: "edit", args: { path: file, old: "before", new: "after" }, result: change };
const readContext = { name: "readFile", args: { path: file, range: [1, 80] }, result: "     1\tcurrent contents" };
const testCall = { name: "runTests", args: { target, timeoutMs: 10000 }, result: passing };

const scenarios: { id: string; label: string; calls: ExpectedCall[]; value: unknown }[] = [
  { id: "grep-empty-widen", label: "nonempty scoped result", calls: [{ name: "grep", args: { path: "src", pattern: "needle", maxResults: 20 }, result: { matches: [match] } }], value: { matches: [match] } },
  { id: "grep-empty-widen", label: "empty result widens once within workspace", calls: [{ name: "grep", args: { path: "src", pattern: "needle", maxResults: 20 }, result: { matches: [] } }, { name: "grep", args: { path: ".", pattern: "needle", maxResults: 20 }, result: { matches: [match] } }], value: { widened: true, matches: [match] } },
  { id: "find-files-empty-widen", label: "nonempty scoped result", calls: [{ name: "findFiles", args: { path: "src", pattern: "*.py" }, result: { files: [file] } }], value: { files: [file], omittedVisible: 0 } },
  { id: "find-files-empty-widen", label: "empty result widens once within workspace", calls: [{ name: "findFiles", args: { path: "src", pattern: "*.py" }, result: { files: [] } }, { name: "findFiles", args: { path: ".", pattern: "*.py" }, result: { files: [file] } }], value: { widened: true, files: [file], omittedVisible: 0 } },
  { id: "read-not-found-locate", label: "existing path is read once", calls: [readContext], value: { path: file, text: readContext.result } },
  { id: "read-not-found-locate", label: "ENOENT locates one exact basename", calls: [{ ...readContext, error: "ENOENT: no such file" }, { name: "findFiles", args: { pattern: "module.py", path: "." }, result: { files: ["lib/module.py"] } }, { name: "readFile", args: { path: "lib/module.py", range: [1, 80] }, result: "     1\tfound" }], value: { path: "lib/module.py", text: "     1\tfound" } },
  { id: "edit-missing-reread", label: "successful exact edit", calls: [editCall], value: { edited: true, change } },
  { id: "edit-missing-reread", label: "missing target returns new anchor context without another write", calls: [{ ...editCall, error: "not found" }, readContext], value: { edited: false, needsAnchor: true, context: readContext.result } },
  { id: "edit-ambiguous-reread", label: "successful exact edit", calls: [editCall], value: { edited: true, change } },
  { id: "edit-ambiguous-reread", label: "ambiguous target never sets all true", calls: [{ ...editCall, error: "not unique (2 matches); add context or pass all: true" }, readContext], value: { edited: false, needsAnchor: true, context: readContext.result } },
  { id: "read-truncated-range", label: "small file needs no second read", calls: [{ name: "readFile", args: { path: file }, result: "     1\tsmall" }], value: { text: "     1\tsmall" } },
  { id: "read-truncated-range", label: "truncated output uses bounded requested range", calls: [{ name: "readFile", args: { path: file }, result: "     1\thead\n[truncated at line 4 of 900; pass range to read more]" }, { name: "readFile", args: { path: file, range: [10, 20] }, result: "    10\ttarget" }], value: { narrowed: true, text: "    10\ttarget" } },
  { id: "command-nonzero-summary", label: "successful explicit command", calls: [{ name: "bash", args: { cmd: "printf ready", timeoutMs: 10000 }, result: { code: 0, out: "ready" } }], value: { code: 0, kind: "success", outputTail: "ready" } },
  { id: "command-nonzero-summary", label: "failed command returns bounded combined-output tail", calls: [{ name: "bash", args: { cmd: "printf ready", timeoutMs: 10000 }, result: { code: 1, out: "x".repeat(2500) + "failure" } }], value: { code: 1, kind: "nonzero-exit", outputTail: "x".repeat(1993) + "failure" } },
  { id: "test-failure-summary", label: "passing named test", calls: [testCall], value: passing },
  { id: "test-failure-summary", label: "failure reports assertion rather than full excerpt", calls: [{ ...testCall, result: failing }], value: { passed: 0, failures: [target], omittedVisibleFailures: 0, firstAssertion: "expected true" } },
  { id: "edit-then-narrow-test", label: "successful edit then explicit verification", calls: [editCall, testCall], value: { change, passed: 1, failures: [], omittedVisibleFailures: 0, firstAssertion: null } },
  { id: "edit-then-narrow-test", label: "failed verification stops without guessing a repair", calls: [editCall, { ...testCall, result: failing }], value: { change, passed: 0, failures: [target], omittedVisibleFailures: 0, firstAssertion: "expected true" } },
  { id: "rename-zero-references", label: "references exist without attempting rename", calls: [{ name: "findReferences", args: { path: file, name: "example" }, result: { references: [match] } }], value: { references: [match], omittedVisible: 0 } },
  { id: "rename-zero-references", label: "no references inspects definition without rename", calls: [{ name: "findReferences", args: { path: file, name: "example" }, result: { references: [] } }, { name: "findDefinition", args: { path: file, name: "example" }, result: { definitions: [{ name: "example", kind: "function", path: file }] } }], value: { needsReview: true, omittedVisible: 0, definitions: [{ name: "example", kind: "function", path: file }] } },
  { id: "move-cycle-diagnose", label: "successful preview never writes", calls: [{ name: "moveSymbol", args: { path: file, name: "example", to: "src/other.py", dryRun: true }, result: change }], value: { preview: change } },
  { id: "move-cycle-diagnose", label: "cycle inspects scoped graph without retrying move", calls: [{ name: "moveSymbol", args: { path: file, name: "example", to: "src/other.py", dryRun: true }, error: "the move would create an import cycle" }, { name: "importGraph", args: { module: file }, result: { cycles: [], edges: [] } }], value: { needsPlan: true, cycles: [], edges: [], omittedVisibleCycles: 0, omittedVisibleEdges: 0 } },
  { id: "check-errors-read", label: "clean check needs no read", calls: [{ name: "check", args: { path: file }, result: { diagnostics: [], counts: { error: 0 } } }], value: { counts: { error: 0 }, status: "clean", error: null } },
  { id: "check-errors-read", label: "first error retrieves bounded nearby lines", calls: [{ name: "check", args: { path: file }, result: { diagnostics: [{ path: file, line: 8, col: 1, severity: "error", message: "bad type" }], counts: { error: 1 } } }, { name: "readFile", args: { path: file, range: [5, 11] }, result: "     8\tbad expression" }], value: { counts: { error: 1 }, error: { path: file, line: 8, message: "bad type" }, context: "     8\tbad expression" } },
];

for (const scenario of scenarios) {
  test(`${scenario.id}: ${scenario.label}`, async () => {
    const result = await execute(scenario.id, validInputs[scenario.id]!, scenario.calls);
    assert.ok(result.ok, JSON.stringify(result));
    assert.deepEqual(result.value, scenario.value);
  });
}

test("file recovery refuses ambiguous, absent, truncated or unsafe discovered paths", async () => {
  const missing: ExpectedCall = { ...readContext, error: "ENOENT: absent" };
  for (const found of [{ files: [] }, { files: ["a/module.py", "b/module.py"] }, { files: ["a/module.py"], truncated: "more results omitted" }]) {
    const result = await execute("read-not-found-locate", validInputs["read-not-found-locate"]!, [missing, { name: "findFiles", result: found }]);
    assert.ok(result.ok);
    assert.equal((result.value as { found: boolean }).found, false);
  }
  for (const path of ["../module.py", "/etc/module.py", "src/different.py"]) {
    const result = await execute("read-not-found-locate", validInputs["read-not-found-locate"]!, [missing, { name: "findFiles", result: { files: [path] } }]);
    assert.equal(result.ok, false);
  }
});

test("root-scoped empty searches do not repeat or leave the workspace", async () => {
  for (const [id, name, result] of [["grep-empty-widen", "grep", { matches: [] }], ["find-files-empty-widen", "findFiles", { files: [] }]] as const) {
    assert.ok((await execute(id, { ...validInputs[id], path: "." }, [{ name, result }])).ok);
  }
});

test("secondary recovery-call errors remain failures rather than fabricated recovery", async () => {
  for (const scenario of scenarios.filter((s) => s.calls.length > 1)) {
    const calls = scenario.calls.map((call, index) => index === scenario.calls.length - 1 ? { ...call, error: "recovery host unavailable" } : call);
    const result = await execute(scenario.id, validInputs[scenario.id]!, calls);
    assert.equal(result.ok, false, scenario.id);
    if (!result.ok) assert.match(result.message, /recovery host unavailable/, scenario.id);
  }
});

test("command statuses distinguish timeout and abort without any retry", async () => {
  for (const [code, kind] of [[124, "timeout"], [130, "aborted"]] as const) {
    const result = await execute("command-nonzero-summary", validInputs["command-nonzero-summary"]!, [{ name: "bash", result: { code, out: "stopped" } }]);
    assert.ok(result.ok);
    assert.deepEqual(result.value, { code, kind, outputTail: "stopped" });
  }
});

test("unsafe diagnostic locations cannot drive follow-on file reads", async () => {
  for (const location of [{ path: "/etc/passwd", line: 1 }, { path: "../private.py", line: 1 }, { path: file, line: 0 }, { path: file, line: 1.5 }]) {
    const result = await execute("check-errors-read", { path: file }, [{ name: "check", result: { counts: { error: 1 }, diagnostics: [{ ...location, severity: "error", message: "bad" }] } }]);
    assert.equal(result.ok, false);
  }
});

test("invalid bounded or narrow inputs fail before any call, including edits", async () => {
  const invalid: [string, State][] = [
    ["grep-empty-widen", { pattern: "[" }], ["grep-empty-widen", { pattern: "" }],
    ["find-files-empty-widen", { pattern: "../*" }], ["find-files-empty-widen", { pattern: "x".repeat(257) }],
    ["read-not-found-locate", { path: "src/*.py" }], ["read-not-found-locate", { path: "src/." }],
    ["edit-missing-reread", { old: "" }], ["edit-missing-reread", { new: 1 }],
    ["edit-ambiguous-reread", { old: "x".repeat(8001) }],
    ["read-truncated-range", { start: 0 }], ["read-truncated-range", { end: 9 }],
    ["read-truncated-range", { start: 1, end: 81 }], ["read-truncated-range", { start: 1.5 }],
    ["command-nonzero-summary", { cmd: " " }], ["command-nonzero-summary", { cmd: "x\u0000y" }],
    ["command-nonzero-summary", { cmd: "x".repeat(4001) }],
    ["test-failure-summary", { target: "." }], ["test-failure-summary", { target: "./" }],
    ["test-failure-summary", { target: "tests/" }], ["test-failure-summary", { target: "tests/test.py#" }],
    ["edit-then-narrow-test", { target: "./" }], ["edit-then-narrow-test", { target: "tests/test.py#A#B" }],
    ["rename-zero-references", { name: "bad-name" }], ["move-cycle-diagnose", { to: file }],
    ["move-cycle-diagnose", { name: "bad.name" }], ["check-errors-read", { path: "." }],
  ];
  for (const [id, override] of invalid) assert.equal((await execute(id, { ...validInputs[id], ...override }, [])).ok, false, `${id}: ${JSON.stringify(override)}`);
});

test("summaries preserve explicit counts for locally omitted results", async () => {
  const files = Array.from({ length: 23 }, (_, i) => `src/file${i}.py`);
  const found = await execute("find-files-empty-widen", validInputs["find-files-empty-widen"]!, [{ name: "findFiles", result: { files, truncated: "host also omitted files" } }]);
  assert.ok(found.ok);
  assert.deepEqual(found.value, { files: files.slice(0, 20), omittedVisible: 3, truncated: "host also omitted files" });
  const failed = Array.from({ length: 7 }, (_, i) => ({ ...failure, id: `test${i}`, message: "x".repeat(1200) }));
  const summary = await execute("test-failure-summary", validInputs["test-failure-summary"]!, [{ name: "runTests", result: { ...failing, failed, truncated: "host omitted failures" } }]);
  assert.ok(summary.ok);
  assert.deepEqual(summary.value, { passed: 0, failures: failed.slice(0, 5).map((f) => f.id), omittedVisibleFailures: 2, firstAssertion: "x".repeat(1000), truncated: "host omitted failures" });
});

test("test summaries retain host truncation and only count omissions from the visible list", async () => {
  const actual = Array.from({ length: 30 }, (_, i) => ({ ...failure, id: `failure${i}` }));
  const failed = actual.slice(0, 15);
  const truncated = "showing 15 of 30; run a single test (target) or failedOnly for the rest";
  for (const id of ["edit-then-narrow-test", "test-failure-summary"]) {
    const calls = [...(id === "edit-then-narrow-test" ? [editCall] : []), { ...testCall, result: { passed: 0, skipped: 0, failed, truncated } }];
    const result = await execute(id, validInputs[id]!, calls);
    assert.ok(result.ok);
    const value = result.value as any;
    assert.deepEqual(value.failures, actual.slice(0, 5).map(f => f.id));
    assert.equal(value.omittedVisibleFailures, 10);
    assert.equal(value.truncated, truncated);
    assert.equal(value.omittedFailures, undefined, "never imply the visible count is exhaustive");
  }
});

test("check with errors outside the visible warning prefix cannot be reported clean", async () => {
  const truncated = "showing 40 of 41; pass path or kinds to narrow";
  const diagnostics = Array.from({ length: 40 }, (_, i) => ({ path: file, line: i + 1, col: 1, severity: "warning", code: "W", message: "warning", source: "ruff" }));
  const counts = { error: 1, warning: 40 };
  const result = await execute("check-errors-read", { path: file }, [{ name: "check", result: { diagnostics, counts, truncated } }]);
  assert.ok(result.ok);
  assert.deepEqual(result.value, { counts, status: "no-visible-error", error: null, truncated });
});

test("zero visible failures and references still preserve upstream truncation", async () => {
  const truncated = "upstream incomplete";
  const result = await execute("test-failure-summary", validInputs["test-failure-summary"]!, [{ ...testCall, result: { ...passing, truncated } }]);
  assert.ok(result.ok);
  assert.equal((result.value as any).truncated, truncated);
  const references = await execute("rename-zero-references", validInputs["rename-zero-references"]!, [
    { name: "findReferences", result: { references: [], truncated } }, { name: "findDefinition", result: { definitions: [] } },
  ]);
  assert.ok(references.ok);
  assert.equal((references.value as any).truncated, truncated);
});
