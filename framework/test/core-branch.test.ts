import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { parseBranchString, runBranch } from "../core/branch/branch.js";

describe("parseBranchString", () => {
  test("returns the body's return value", async () => {
    const fn = parseBranchString("return 1 + 2;");
    assert.equal(await fn({}), 3);
  });

  test("can call sync and async tools", async () => {
    const fn = parseBranchString(
      "const a = tools.sync(2); const b = await tools.async(3); return a + b;",
    );
    const result = await fn({ sync: (n: number) => n * 10, async: async (n: number) => n + 1 });
    assert.equal(result, 24);
  });

  test("rejects when the body throws", async () => {
    const fn = parseBranchString('throw new Error("boom");');
    await assert.rejects(fn({}), /boom/);
  });

  test("throws at parse time on a syntax error", () => {
    assert.throws(() => parseBranchString("return (;"));
  });

  test("runs in strict mode", async () => {
    const fn = parseBranchString("undeclaredVar = 1;");
    await assert.rejects(fn({}), ReferenceError);
  });

  test("does not see module locals", async () => {
    const fn = parseBranchString('return typeof stripTypeScriptTypes === "undefined";');
    assert.equal(await fn({}), true);
  });
});

describe("runBranch", () => {
  test("returns ok value", async () => {
    const r = await runBranch(parseBranchString("return 5;"), {});
    assert.deepEqual(r, { ok: true, value: 5 });
  });

  test("reports error line (user line 1 maps to 1)", async () => {
    const r = await runBranch(parseBranchString('throw new Error("one");'), {});
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.line, 1);
  });

  test("reports line 3 of a 4-line body", async () => {
    const r = await runBranch(
      parseBranchString('const a = 1;\nconst b = 2;\nthrow new Error("bad");\nreturn a + b;'),
      {},
    );
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.message, "bad");
      assert.equal(r.line, 3);
    }
  });

  test("sync tool error maps to the calling line", async () => {
    const fn = parseBranchString("const a = 1;\ntools.boom();\nreturn a;");
    const r = await runBranch(fn, { boom: () => { throw new Error("sync boom"); } });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.message, "sync boom");
      assert.equal(r.line, 2);
    }
  });

  test("async tool error maps to the calling line", async () => {
    const fn = parseBranchString("const a = await tools.ok();\nawait tools.boom();\nreturn a;");
    const r = await runBranch(fn, {
      ok: async () => 1,
      boom: async () => { throw new Error("async boom"); },
    });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.message, "async boom");
      assert.equal(r.line, 2);
    }
  });

  test("thrown string has message and no line", async () => {
    const r = await runBranch(parseBranchString('throw "x";'), {});
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.message, "x");
      assert.equal(r.line, undefined);
    }
  });

  test("nested function reports the throw line", async () => {
    const fn = parseBranchString("function f() {\n  throw new Error(\"deep\");\n}\nf();");
    const r = await runBranch(fn, {});
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.line, 2);
  });

  test("does not throw when fn rejects", async () => {
    const r = await runBranch(async () => { throw new Error("rej"); }, {});
    assert.equal(r.ok, false);
  });

  test("aborts on timeout signal with a never-resolving tool", async () => {
    const fn = parseBranchString("return await tools.hang();");
    const r = await runBranch(fn, { hang: () => new Promise(() => {}) }, { signal: AbortSignal.timeout(50) });
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.aborted, true);
      assert.ok(r.message.startsWith("aborted:"));
    }
  });

  test("pre-aborted signal does not call fn", async () => {
    let called = false;
    const r = await runBranch(async () => { called = true; return 1; }, {}, { signal: AbortSignal.abort("stop") });
    assert.equal(called, false);
    assert.equal(r.ok, false);
    if (!r.ok) {
      assert.equal(r.aborted, true);
      assert.equal(r.message, "aborted: stop");
    }
  });

  test("late rejection after abort is not an unhandledRejection", async () => {
    const seen: unknown[] = [];
    const listener = (e: unknown) => { seen.push(e); };
    process.on("unhandledRejection", listener);
    try {
      const ac = new AbortController();
      setTimeout(() => ac.abort("late"), 10);
      const fn = parseBranchString("await tools.slowFail();");
      const r = await runBranch(
        fn,
        { slowFail: () => new Promise((_, rej) => setTimeout(() => rej(new Error("later")), 30)) },
        { signal: ac.signal },
      );
      assert.equal(r.ok, false);
      await new Promise((res) => setTimeout(res, 60));
      assert.deepEqual(seen, []);
    } finally {
      process.off("unhandledRejection", listener);
    }
  });

  test("tool closing over the signal observes abort", async () => {
    const ac = new AbortController();
    let observed: boolean | undefined;
    const tools = {
      hang: () => new Promise(() => {}),
      check: () => { observed = ac.signal.aborted; },
    };
    setTimeout(() => ac.abort(new Error("cancel")), 10);
    const r = await runBranch(parseBranchString("await tools.hang();"), tools, { signal: ac.signal });
    tools.check();
    assert.equal(observed, true);
    assert.equal(r.ok, false);
    if (!r.ok) assert.equal(r.message, "aborted: cancel");
  });

  test("un-aborted signal still returns ok value", async () => {
    const r = await runBranch(parseBranchString("return 7;"), {}, { signal: new AbortController().signal });
    assert.deepEqual(r, { ok: true, value: 7 });
  });
});
