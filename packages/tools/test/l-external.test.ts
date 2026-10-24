import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { test } from "node:test";
import { catalog, externalTools, fixtureResult, type ToolCtx } from "../src/index.ts";

const ctx: ToolCtx = { root: "/tmp", signal: new AbortController().signal };
const tool = (n: string) => externalTools.find((t) => t.name === n)!;
const call = (n: string, args: object) => tool(n).fn(args, ctx) as Promise<any>;

test("14 external tools, each with a fixture file", () => {
  assert.equal(externalTools.length, 14);
  const files = readdirSync(new URL("../fixtures/external/", import.meta.url)).map((f) => f.replace(/\.json$/, "")).sort();
  assert.deepEqual(files, externalTools.map((t) => t.name).sort());
  assert.deepEqual(catalog("L", { root: "/tmp", partial: true }).slice(-14), externalTools);
});

test("first matching case wins; string match is a case-insensitive substring; other values deep-equal", async () => {
  assert.equal((await call("issues", { op: "get", id: "PROJ-123" })).issue.title, "Login times out behind the corporate proxy");
  // case order: the specific case comes before the generic `op: get` one
  assert.equal((await call("issues", { op: "get", id: "PROJ-7" })).issue.id, "PROJ-7");
  assert.equal((await call("issues", { op: "search", query: "LOGIN fails" })).issues[0].id, "PROJ-123");
  assert.equal((await call("pullRequests", { op: "comments", number: 212 })).comments.length, 2);
  assert.deepEqual((await call("pullRequests", { op: "comments", number: 7 })).comments, []);
  assert.equal((await call("httpRequest", { url: "https://api.example.com/health" })).status, 200);
  assert.equal((await call("httpRequest", { method: "POST", url: "https://api.example.com/things" })).status, 201);
});

test("default when nothing matches; {{arg}} placeholders filled", async () => {
  const r = await call("ciStatus", { branch: "feature/x" });
  assert.equal(r.branch, "feature/x");
  assert.equal(r.runs.length, 3);
  assert.equal((await call("ciStatus", { branch: "fix/config-missing" })).runs[0].status, "failed");
  assert.equal((await call("webSearch", { query: "zebra" })).results[0].title, "Search results for zebra");
  assert.equal((await call("notify", { channel: "#eng", message: "hi" })).channel, "#eng");
  assert.equal((await call("packageInfo", { name: "attrs" })).docs, "https://pypi.org/project/attrs/");
});

test("deterministic: same args, identical results; results are not shared mutable state", async () => {
  for (const t of externalTools) {
    const args = { op: "list", query: "q", id: "I-1", url: "https://e.x/a", sql: "select 1", name: "n", channel: "#c", message: "m", service: "api", metric: "latency", branch: "main", flag: "f" };
    const a = await t.fn(args, ctx), b = await t.fn(args, ctx);
    assert.deepEqual(a, b, t.name);
    assert.notEqual(a, b, t.name);
  }
  const a: any = fixtureResult("featureFlags", { op: "list" });
  a.flags.length = 0;
  assert.equal((fixtureResult("featureFlags", { op: "list" }) as any).flags.length, 3);
});

test("sqlQuery is read-only; installPackage installs nothing", async () => {
  await assert.rejects(call("sqlQuery", { sql: "DELETE FROM users" }), /only read-only queries/);
  assert.equal((await call("sqlQuery", { sql: "SELECT * FROM users" })).rowCount, 3);
  assert.equal((await call("sqlQuery", { sql: "select count(*) from orders" })).rows[0][0], 128);
  const r = await call("installPackage", { name: "definitely-not-installed-xyz" });
  assert.equal(r.installed, true);
  assert.equal(r.name, "definitely-not-installed-xyz");
});
