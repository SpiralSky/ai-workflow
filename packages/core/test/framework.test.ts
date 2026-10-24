import test from "node:test";
import assert from "node:assert/strict";
import { createReporter, type Sink } from "@aiw/telemetry";
import { basePrompt, buildFramework, buildRegistry } from "../src/index.ts";
import type { CallCtx, Host, HostCallRequest, HostToolDecl } from "../src/index.ts";

const decl = (name: string, extra: Partial<HostToolDecl> = {}): HostToolDecl => ({
  name, description: `does ${name}`, inputSchema: { type: "object", properties: { q: { type: "string" } } }, ...extra,
});

class FakeHost implements Host {
  calls: HostCallRequest[] = [];
  constructor(private decls: HostToolDecl[], private result: unknown = "ok") {}
  async tools() { return this.decls; }
  async call(req: HostCallRequest, _ctx: CallCtx) {
    this.calls.push(req);
    if (req.name === "boom") throw new Error("kaboom");
    return typeof this.result === "function" ? (this.result as (r: HostCallRequest) => unknown)(req) : this.result;
  }
  async close() {}
}

const sink: Sink = { write: () => {} };
const mkCall = () => ({ reporter: createReporter({ sink, writer: "r" }).child("t") });

async function setup(decls: HostToolDecl[], result?: unknown) {
  const host = new FakeHost(decls, result);
  return { host, registry: buildRegistry(await host.tools(), { warn: () => {} }) };
}

test("baseline mirrors routed tools, dispatches, caps, reports errors", async () => {
  const { host, registry } = await setup([decl("mcp__s__big_one"), decl("boom"), decl("hid", { routing: "direct" })], "z".repeat(500));
  const fw = buildFramework("baseline", registry, { host, outputCap: 100 });
  assert.equal(fw.instructions, "");
  assert.deepEqual(fw.state, {});
  assert.deepEqual(fw.tools.map((t) => t.name), ["s_bigOne", "boom"]);
  assert.equal(fw.tools[0]!.description, "does mcp__s__big_one");
  const r = await fw.tools[0]!.handle({ q: "x" }, mkCall());
  assert.ok(!r.isError && r.text.includes("[truncated") && Buffer.byteLength(r.text) <= 100);
  assert.equal(host.calls[0]!.name, "mcp__s__big_one");
  assert.deepEqual(host.calls[0]!.args, { q: "x" });
  assert.deepEqual(await fw.tools[1]!.handle({}, mkCall()), { text: "kaboom", isError: true });
});

test("baseline stringifies structured results", async () => {
  const { host, registry } = await setup([decl("a")], { n: 1 });
  const r = await buildFramework("baseline", registry, { host }).tools[0]!.handle({}, mkCall());
  assert.equal(r.text, JSON.stringify({ n: 1 }, null, 2));
});

test("branch-only runs programs, keeps state, description has declarations", async () => {
  const { host, registry } = await setup([decl("read_file")], (r: HostCallRequest) => `got ${(r.args as any).q}`);
  const fw = buildFramework("branch-only", registry, { host });
  assert.deepEqual(fw.tools.map((t) => t.name), ["branch"]);
  assert.ok(fw.instructions.length > 0);
  const t = fw.tools[0]!;
  assert.ok(t.description.includes("```ts") && t.description.includes("readFile(args:"));
  assert.ok(!t.description.includes("tools(args"));
  const r1 = await t.handle({ code: `async (tools, state) => { state.n = 1; return await tools.readFile({ q: "hi" }); }` }, mkCall());
  assert.ok(!r1.isError, r1.text);
  assert.ok(r1.text.includes("got hi"), r1.text);
  const r2 = await t.handle({ code: `async (tools, state) => state.n + 1` }, mkCall());
  assert.ok(r2.text.includes("2"), r2.text);
  assert.equal(fw.state.n, 1);
});

test("branch-only serialises concurrent calls", async () => {
  const { host, registry } = await setup([decl("a")], "x");
  const t = buildFramework("branch-only", registry, { host }).tools[0]!;
  const [a, b] = await Promise.all([
    t.handle({ code: `async (tools, state) => { await tools.a({}); state.v = "first"; return 1; }` }, mkCall()),
    t.handle({ code: `async (tools, state) => state.v` }, mkCall()),
  ]);
  assert.ok(!a.isError, a.text);
  assert.ok(b.text.includes("first"), b.text);
});

test("branch-only compile and argument errors", async () => {
  const { host, registry } = await setup([decl("a")]);
  const t = buildFramework("branch-only", registry, { host }).tools[0]!;
  const r = await t.handle({ code: "not a program (" }, mkCall());
  assert.ok(r.isError && r.text.length > 0);
  assert.ok((await t.handle({}, mkCall())).isError);
});

test("maxChars cap adds the tools inner call", async () => {
  const many = Array.from({ length: 6 }, (_, i) => decl(`tool_${i}`, { description: "long ".repeat(40) }));
  const { host, registry } = await setup(many, "x");
  const fw = buildFramework("branch-only", registry, { host, maxChars: 600 });
  const t = fw.tools[0]!;
  assert.ok(t.description.includes("more tools not shown") && t.description.includes("tools(args"));
  const r = await t.handle({ code: `async (tools) => (await tools.tools({ names: ["tool5"] })).includes("tool5(args")` }, mkCall());
  assert.ok(!r.isError && r.text.includes("true"), r.text);
  const all = await t.handle({ code: `async (tools) => (await tools.tools({})).includes("tool0(args")` }, mkCall());
  assert.ok(all.text.includes("true"), all.text);
  const bad = await t.handle({ code: `async (tools) => await tools.tools({ names: ["x"] })` }, mkCall());
  assert.ok(bad.isError && bad.text.includes("unknown tool: x"), bad.text);
  // a cap that omits nothing adds no inner tool
  const fw2 = buildFramework("branch-only", registry, { host, maxChars: 1_000_000 });
  assert.ok(!fw2.tools[0]!.description.includes("tools(args"));
});

test("unbuilt frameworks and variants throw", async () => {
  const { host, registry } = await setup([decl("a")]);
  assert.throws(() => buildFramework("orchestrate", registry, { host }), /orchestrate is not built yet/);
  assert.throws(() => buildFramework("baseline", registry, { host, variant: { toolSearch: true } }), /toolSearch is not built yet/);
  assert.throws(() => buildFramework("baseline", registry, { host, variant: { catalog: 50 } }), /catalog is not built yet/);
  assert.throws(() => buildFramework("nope" as any, registry, { host }), /unknown framework/);
});

test("fingerprint is stable and tracks tool changes", async () => {
  const a = await setup([decl("a"), decl("b")]);
  const b = await setup([decl("a"), decl("b")]);
  const c = await setup([decl("a"), decl("c")]);
  for (const kind of ["baseline", "branch-only"] as const) {
    const fa = buildFramework(kind, a.registry, { host: a.host }).fingerprint;
    assert.deepEqual(buildFramework(kind, b.registry, { host: b.host }).fingerprint, fa);
    assert.notEqual(buildFramework(kind, c.registry, { host: c.host }).fingerprint.toolsHash, fa.toolsHash);
  }
});

test("basePrompt is non-empty", () => {
  assert.ok(basePrompt().trim().length > 0);
});
