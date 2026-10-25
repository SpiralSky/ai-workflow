import { test } from "node:test";
import assert from "node:assert/strict";
import { LocalHost } from "../src/local.ts";

const ROOT = process.cwd();

test("LocalHost tier S lists tools", async () => {
  const host = new LocalHost("S", { root: ROOT });
  const tools = await host.tools();
  assert.ok(tools.length >= 6, `expected at least 6 S-tier tools, got ${tools.length}`);
  const names = tools.map((t) => t.name);
  assert.ok(names.includes("bash"), "bash tool missing from S tier");
  assert.ok(names.includes("readFile"), "readFile tool missing from S tier");
  assert.ok(names.includes("writeFile"), "writeFile tool missing from S tier");
});

test("LocalHost tier L lists more tools than tier S", async () => {
  const hostS = new LocalHost("S", { root: ROOT });
  const hostL = new LocalHost("L", { root: ROOT });
  const sTools = await hostS.tools();
  const lTools = await hostL.tools();
  assert.ok(lTools.length > sTools.length, `L tier (${lTools.length}) should have more tools than S tier (${sTools.length})`);
});

test("LocalHost tier S calls bash with echo hello", async () => {
  const host = new LocalHost("S", { root: ROOT });
  const ac = new AbortController();
  const result = await host.call(
    { id: "test-1", parent: "", name: "bash", args: { cmd: "echo hello" } },
    { signal: ac.signal, pauseTimeout: () => () => {} },
  );
  // bash returns { code: number; out: string }
  assert.ok(result !== null && typeof result === "object", "bash result should be an object");
  const r = result as { code: number; out: string };
  assert.strictEqual(r.code, 0, `bash exited with code ${r.code}: ${r.out}`);
  assert.ok(r.out.trim().includes("hello"), `expected "hello" in output, got: ${r.out}`);
});
