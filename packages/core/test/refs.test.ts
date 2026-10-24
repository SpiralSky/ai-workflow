import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { extractRefs, validateRefs, formatRefIssues, listValidRefs, RefStore, stateProxy, resolveRef, renderReferences, type CodeReader, type ResolveContext } from "../src/index.ts";

const sha = (s: string) => createHash("sha1").update(s).digest("hex");
const kinds = (text: string) => extractRefs(text).map((t) => `${t.kind}:${t.raw}`);

/** Store with two finished steps. */
function fixture() {
  const store = new RefStore();
  const s1 = store.startStep({ instruction: "run tests", executor: "m" });
  store.addCall(s1, { tool: "bash", args: { cmd: "npm test" }, result: "FAIL a\nok b\nFAIL c\n" + "x".repeat(3000), outcome: { ok: false, exitCode: 1 } });
  store.addCall(s1, { tool: "readFile", args: { path: "a" }, result: "tiny", outcome: { ok: true } });
  store.finishStep(s1, { report: "3 tests failed. See @s1.c1" });
  const s2 = store.startStep({ instruction: "fix" });
  store.finishStep(s2, { report: "fixed", changed: { added: [], modified: ["src/p.py"], deleted: [] } });
  return store;
}

test("grammar: all forms", () => {
  assert.deepEqual(kinds("see @s2, @s2..s4 @s1.c3 @failingTests @name@s2 @src/p.py#A.b. and @./Makefile)"), [
    "step:@s2",
    "range:@s2..s4",
    "call:@s1.c3",
    "named:@failingTests",
    "namedAt:@name@s2",
    "code:@src/p.py#A.b",
    "code:@./Makefile",
  ]);
  const t = extractRefs("@src/p.py#A.b")[0]!;
  assert.deepEqual({ ...t }, { raw: "@src/p.py#A.b", start: 0, end: 13, kind: "code", path: "src/p.py", symbol: "A.b" });
});

test("grammar: literal @, emails, offsets, malformed", () => {
  assert.deepEqual(kinds("mail a@b.com and @@s2 here"), []);
  assert.deepEqual(kinds("(`@s1`)"), ["step:@s1"]);
  const t = extractRefs("x @s5!")[0]!;
  assert.equal(t.start, 2);
  assert.equal(t.end, 5);
  assert.deepEqual(kinds("@Makefile#x @s1@s2 @src/a.py#"), ["malformed:@Makefile#x", "malformed:@s1@s2", "malformed:@src/a.py#"]);
  assert.deepEqual(kinds("lone @ sign"), []);
});

test("validation lists valid references", async () => {
  const store = fixture();
  store.setNamed("failing", [1], 1, "one");
  const issues = await validateRefs(extractRefs("@s1 @s9 @s1.c7 @nope @failing@s1 @failing@s0 @s3..s2 @@x"), store);
  assert.deepEqual(issues.map((i) => i.token.raw), ["@s9", "@s1.c7", "@nope", "@failing@s0", "@s3..s2"]);
  const msg = formatRefIssues(issues, store);
  assert.match(msg, /Valid references: @s1, @s1\.c1\.\.c2, @s2, @failing/);
  assert.deepEqual(listValidRefs(store).slice(0, 3), ["@s1", "@s1.c1..c2", "@s2"]);
  assert.equal((await validateRefs(extractRefs("@a/b.py"), store, { pathExists: async () => false }))[0]!.problem, "unknown");
});

test("eviction drops oldest unnamed call results; resolving throws expired", async () => {
  const store = new RefStore(300);
  const s = store.startStep({ instruction: "i" });
  store.addCall(s, { tool: "t", args: {}, result: "a".repeat(200), outcome: { ok: true } });
  store.setNamed("keep", "k".repeat(50), s);
  store.addCall(s, { tool: "t", args: {}, result: "b".repeat(200), outcome: { ok: true } });
  assert.ok(store.isEvicted(s, 1));
  assert.ok(!store.isEvicted(s, 2));
  assert.equal(store.getNamed("keep").value, "k".repeat(50));
  const ctx = { store, reader: { readFile: async () => "" } };
  await assert.rejects(resolveRef(ctx, { ref: "@s1.c1" }), (e: any) => e.code === "expired");
  assert.equal((await validateRefs(extractRefs("@s1.c1"), store))[0]!.problem, "expired");
});

test("state proxy writes named values with history", () => {
  const store = fixture();
  let cur = 1;
  const state = stateProxy(store, () => cur);
  state.x = { a: 1 };
  cur = 2;
  state.x = { a: 2 };
  assert.deepEqual(state.x, { a: 2 });
  assert.deepEqual(Object.keys(state), ["x"]);
  assert.deepEqual(store.getNamed("x", 1).value, { a: 1 });
  assert.equal("x" in state, true);
  store.save({ name: "y", value: "v", summary: "sum" }, 2);
  assert.equal(state.y, "v");
  assert.equal(store.getNamed("y").summary, "sum");
  delete state.x;
  assert.deepEqual(Object.keys(state), ["y"]);
  assert.deepEqual(store.getNamed("x", 1).value, { a: 1 });
  assert.throws(() => (state["s3"] = 1), /not a valid reference name/);
  assert.equal(store.getNamed("x", 1).kind, "snapshot");
});

/** Reader backed by a mutable file map. */
function reader(files: Record<string, string>, withSymbol = true): CodeReader {
  const get = async (p: string) => {
    if (!(p in files)) throw Object.assign(new Error(`ENOENT ${p}`), { code: "ENOENT" });
    return files[p]!;
  };
  return {
    readFile: get,
    readSymbol: withSymbol ? async (p, s) => `def ${s}():\n    pass # ${(await get(p)).length}` : undefined,
  };
}

test("inline vs handle rendering, nested refs as handles", async () => {
  const store = fixture();
  const ctx: ResolveContext = { store, reader: reader({}) };
  const r = await renderReferences(ctx, "do @s1.c1 and @s1.c2 and @s1 also @s1");
  assert.equal(r.records.filter((x) => !x.nested).length, 3);
  assert.deepEqual(r.records.map((x) => [x.ref, x.mode]), [["@s1.c1", "handle"], ["@s1.c2", "inline"], ["@s1", "inline"]]);
  assert.match(r.handles[0]!, /^@s1\.c1 — step 1, bash `npm test`, \d+(\.\d+k)? tokens: exit 1$/);
  assert.match(r.text, /@s1\.c2 \(from step 1\):\ntiny/);
  // @s1's report mentions @s1.c1 which is already seen; use fresh store to see nesting
  const s3 = store.startStep({ instruction: "i" });
  store.finishStep(s3, { report: "see @s1.c2 and @missing" });
  const r2 = await renderReferences(ctx, "@s3");
  assert.deepEqual(r2.records.map((x) => [x.ref, x.mode, !!x.nested]), [["@s3", "inline", false], ["@s1.c2", "handle", true]]);
});

test("named summaries and live handle", async () => {
  const store = fixture();
  store.setNamed("big", "z".repeat(5000), 1, "five thousand zeds");
  store.setNamed("big2", "z".repeat(5000), 1);
  const ctx: ResolveContext = { store, reader: reader({ "src/p.py": "abc" }) };
  const r = await renderReferences(ctx, "@big @big2 @src/p.py#f");
  assert.equal(r.handles[0], "@big — five thousand zeds");
  assert.match(r.handles[1]!, /^@big2 — string, 1\.3k tokens$/);
  assert.match(r.inline[0]!.text, /def f\(\)/);
});

test("resolve slicing: grep, lines, cap", async () => {
  const ctx: ResolveContext = { store: fixture(), reader: reader({}) };
  assert.equal((await resolveRef(ctx, { ref: "@s1.c1", grep: "^FAIL" })).text, "1: FAIL a\n3: FAIL c");
  assert.equal((await resolveRef(ctx, { ref: "@s1.c1", lines: [2, 3] })).text, "ok b\nFAIL c");
  assert.equal((await resolveRef(ctx, { ref: "@s1.c1", lines: [2, 3], grep: "FAIL" })).text, "3: FAIL c");
  ctx.store.setNamed("huge", "y".repeat(9000), 1);
  const full = await resolveRef(ctx, { ref: "@huge" });
  assert.ok(full.text.length < 4200 && /truncated/.test(full.text));
  await assert.rejects(resolveRef(ctx, { ref: "@s1.c1", grep: "(" }), /valid regex/);
  await assert.rejects(resolveRef(ctx, { ref: "@s1.c1", lines: [0, 1] }), /lines must be/);
  assert.equal((await resolveRef(ctx, { ref: "@s1..s2" })).text.includes("--- step 2 ---"), true);
});

test("live refs: stale detection, step that changed it, RefNotFound, whole-file fallback", async () => {
  const store = fixture();
  const files: Record<string, string> = { "src/p.py": "v1" };
  const rd = reader(files);
  const ctx: ResolveContext = { store, reader: rd };
  const sym = await rd.readSymbol!("src/p.py", "f");
  const live = { ref: "src/p.py#f", version: sha(sym) };
  let res = await resolveRef(ctx, { ref: live });
  assert.equal(res.stale, false);
  files["src/p.py"] = "version-2";
  res = await resolveRef(ctx, { ref: live });
  assert.deepEqual([res.stale, res.step], [true, 2]);
  assert.match(res.text, /def f/);
  // named live ref via token
  store.setNamed("fn", live, 1);
  assert.equal(store.getNamed("fn").kind, "live");
  assert.equal((await resolveRef(ctx, { ref: "@fn" })).stale, true);
  // deleted
  delete files["src/p.py"];
  await assert.rejects(resolveRef(ctx, { ref: live }), (e: any) => e.name === "RefNotFound");
  await assert.rejects(resolveRef(ctx, { ref: "@src/p.py" }), (e: any) => e.name === "RefNotFound");
  // fallback
  const noSym: ResolveContext = { store, reader: reader({ "a.py": "body" }, false) };
  assert.equal((await resolveRef(noSym, { ref: "@a.py#g" })).text, "[symbol extraction unavailable; whole file a.py]\nbody");
  assert.equal((await resolveRef(noSym, { ref: "@a.py" })).text, "body");
});
