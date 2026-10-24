import test from "node:test";
import assert from "node:assert/strict";
import { createReporter, type Sink } from "@aiw/telemetry";
import {
  CheckedHost, CompositeHost, DEFAULT_OUTPUT_CAP, HostError, bindTools, buildRegistry, capOutput, fromMCPResult,
} from "../src/index.ts";
import type { CallCtx, CheckCall, CheckDecision, Checker, Host, HostCallRequest, HostToolDecl } from "../src/index.ts";

const decl = (name: string, extra: Partial<HostToolDecl> = {}): HostToolDecl => ({
  name, description: "d", inputSchema: { type: "object" }, ...extra,
});

class FakeHost implements Host {
  calls: { req: HostCallRequest; ctx: CallCtx }[] = [];
  closed = false;
  constructor(private decls: HostToolDecl[], private result: unknown = "ok") {}
  async tools() { return this.decls; }
  async call(req: HostCallRequest, ctx: CallCtx) { this.calls.push({ req, ctx }); return this.result; }
  async close() { this.closed = true; }
}

const mkCtx = () => {
  const log: string[] = [];
  const ctx: CallCtx = { signal: new AbortController().signal, pauseTimeout: () => { log.push("pause"); return () => log.push("resume"); } };
  return { ctx, log };
};
const req = (name: string, args: unknown = {}): HostCallRequest => ({ id: "i", parent: "p", name, args });

test("HostError name", () => {
  assert.equal(new HostError("x").name, "HostError");
});

test("fromMCPResult", () => {
  const text = (t: string) => ({ type: "text", text: t });
  assert.deepEqual(fromMCPResult({ content: [text('{"a":1}')] }), { a: 1 });
  assert.deepEqual(fromMCPResult({ content: [text("[1,2]")] }), [1, 2]);
  assert.equal(fromMCPResult({ content: [text("42")] }), "42");
  assert.equal(fromMCPResult({ content: [text("hello")] }), "hello");
  assert.throws(() => fromMCPResult({ isError: true, content: [text("a"), text("b")] }), /^Error: a\nb$/);
  assert.deepEqual(fromMCPResult({ structuredContent: { s: 1 }, content: [text('{"a":1}')] }), { s: 1 });
  const img = { type: "image", data: "xx" };
  assert.deepEqual(fromMCPResult({ content: [text('{"a":1}'), text("7"), img] }), [{ a: 1 }, "7", img]);
  assert.equal(fromMCPResult({}), null);
  assert.equal(fromMCPResult({ content: [] }), null);
});

test("CompositeHost dispatches, closes, rejects collisions", async () => {
  const a = new FakeHost([decl("read_file")], "A");
  const b = new FakeHost([decl("Bash")], "B");
  const c = new CompositeHost([a, b]);
  assert.deepEqual((await c.tools()).map((d) => d.name), ["read_file", "Bash"]);
  const { ctx } = mkCtx();
  assert.equal(await c.call(req("Bash"), ctx), "B");
  assert.equal(await c.call(req("read_file"), ctx), "A");
  await assert.rejects(c.call(req("nope"), ctx), /unknown tool: nope/);
  await c.close();
  assert.ok(a.closed && b.closed);
  await assert.rejects(new CompositeHost([a, new FakeHost([decl("read_file")])]).tools(), /Duplicate/);
  await assert.rejects(new CompositeHost([a, new FakeHost([decl("read-file")])]).tools(), /read_file.*read-file/);
  // call before tools() loads lazily
  assert.equal(await new CompositeHost([a]).call(req("read_file"), ctx), "A");
  const bad: Host = { tools: async () => [], call: async () => null, close: async () => { throw new Error("boom"); } };
  await assert.rejects(new CompositeHost([bad, b]).close(), /boom/);
  assert.ok(b.closed);
});

const checker = (d: CheckDecision, seen: CheckCall[] = [], after: unknown[] = []): Checker => ({
  async check(call) { seen.push(call); return d; },
  async after(call, result) { after.push([call.name, result]); },
});

test("CheckedHost allow, deny, modified args, after hook", async () => {
  const inner = new FakeHost([decl("my_tool", { meta: { effect: "read" } })], "R");
  const seen: CheckCall[] = [];
  const after: unknown[] = [];
  const { ctx } = mkCtx();
  const h = new CheckedHost(inner, checker({ decision: "allow", args: { x: 2 } }, seen, after), { session: () => ({}) });
  assert.equal(await h.call(req("my_tool", { x: 1 }), ctx), "R");
  assert.deepEqual(seen[0], { name: "myTool", hostName: "my_tool", args: { x: 1 }, effect: "read" });
  assert.deepEqual(inner.calls[0]!.req.args, { x: 2 });
  assert.deepEqual(after, [["myTool", "R"]]);
  const d = new CheckedHost(inner, checker({ decision: "deny" }), { session: () => ({}) });
  await assert.rejects(d.call(req("my_tool"), ctx), /denied: policy/);
  const d2 = new CheckedHost(inner, checker({ decision: "deny", reason: "nope" }), { session: () => ({}) });
  await assert.rejects(d2.call(req("my_tool"), ctx), /denied: nope/);
  assert.equal(inner.calls.length, 1);
});

test("CheckedHost ask flow pauses the timeout", async () => {
  const inner = new FakeHost([decl("t")]);
  const ask = checker({ decision: "ask", reason: "why" });
  const { ctx, log } = mkCtx();
  const yes = new CheckedHost(inner, ask, { session: () => ({}), approve: async (_c, r) => { log.push(`approve:${r}`); return true; } });
  await yes.call(req("t"), ctx);
  assert.deepEqual(log, ["pause", "approve:why", "resume"]);
  assert.equal(inner.calls.length, 1);
  const no = new CheckedHost(inner, ask, { session: () => ({}), approve: async () => false });
  await assert.rejects(no.call(req("t"), ctx), /denied: declined by user/);
  const none = new CheckedHost(inner, ask, { session: () => ({}) });
  await assert.rejects(none.call(req("t"), ctx), /denied: no approval channel/);
  const thrower = new CheckedHost(inner, ask, { session: () => ({}), approve: async () => { throw new Error("x"); } });
  log.length = 0;
  await assert.rejects(thrower.call(req("t"), ctx), /x/);
  assert.deepEqual(log, ["pause", "resume"]);
  assert.equal(inner.calls.length, 1);
});

test("CheckedHost read-only denies non-read without consulting checker", async () => {
  const inner = new FakeHost([decl("r", { meta: { effect: "read" } }), decl("w")]);
  const seen: CheckCall[] = [];
  const h = new CheckedHost(inner, checker({ decision: "allow" }, seen), { session: () => ({ readOnly: true }) });
  const { ctx } = mkCtx();
  await assert.rejects(h.call(req("w"), ctx), /denied: read-only mode/);
  assert.equal(seen.length, 0);
  await h.call(req("r"), ctx);
  assert.equal(seen.length, 1);
});

test("capOutput", () => {
  assert.equal(capOutput("abc", 10), "abc");
  const obj = { a: 1 };
  assert.equal(capOutput(obj, 100), obj);
  const out = capOutput("x".repeat(1000), 200) as string;
  assert.ok(Buffer.byteLength(out) <= 200);
  assert.match(out, /\n\[truncated: showed \d+ of 1000 bytes; request less/);
  const j = capOutput({ s: "y".repeat(1000) }, 200) as string;
  assert.equal(typeof j, "string");
  assert.ok(j.startsWith('{"s":"yy') && Buffer.byteLength(j) <= 200);
  const m = capOutput("é".repeat(500), 200) as string;
  assert.ok(Buffer.byteLength(m) <= 200);
  assert.ok(!m.includes("�"));
  assert.equal(DEFAULT_OUTPUT_CAP, 8192);
});

test("bindTools end to end", async () => {
  const lines: any[] = [];
  const sink: Sink = { write: (l) => { lines.push(JSON.parse(JSON.stringify(l))); } };
  const reporter = createReporter({ sink, writer: "r" }).child("branch");
  const host = new FakeHost([decl("mcp__s__big_one"), decl("self_cap", { capsOutput: true }), decl("hidden", { routing: "direct" })], "z".repeat(500));
  const registry = buildRegistry(await host.tools());
  const tools = bindTools(registry, host, { reporter, outputCap: 100 });
  assert.deepEqual(Object.keys(tools).sort(), ["s_bigOne", "selfCap"]);
  const { ctx } = mkCtx();
  const out = (await tools.s_bigOne!({ q: 1 }, ctx)) as string;
  assert.ok(Buffer.byteLength(out) <= 100 && out.includes("[truncated"));
  const { req: got, ctx: gotCtx } = host.calls[0]!;
  assert.equal(gotCtx, ctx);
  assert.equal(got.name, "mcp__s__big_one");
  assert.deepEqual(got.args, { q: 1 });
  assert.equal(got.parent, reporter.scope);
  const toolEv = lines.find((l) => l.kind === "tool");
  assert.equal(toolEv.id, got.id);
  assert.equal(((await tools.selfCap!({}, ctx)) as string).length, 500);
  assert.throws(() => bindTools(registry, host, { reporter, names: ["nope"] }), /unknown tool/);
  assert.deepEqual(Object.keys(bindTools(registry, host, { reporter, names: ["selfCap"] })), ["selfCap"]);
});
