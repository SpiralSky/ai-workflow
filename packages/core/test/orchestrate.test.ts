import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReporter, type EventRecord, type LLMClient, type Sink } from "@aiw/telemetry";
import { buildFramework, buildRegistry, distractorDecls, padRegistry, RWLock } from "../src/index.ts";
import type { CallCtx, Framework, Host, HostCallRequest, HostToolDecl } from "../src/index.ts";
import { runtime } from "./engine.ts";

const decl = (name: string, whenToUse: string, effect: "read" | "write" | "exec" = "read"): HostToolDecl => ({
  name, description: whenToUse, inputSchema: { type: "object", properties: { q: { type: "string" } } }, meta: { whenToUse, effect },
});
const DECLS = [decl("readFile", "read the contents of a file"), decl("runTests", "run the test suite", "exec"), decl("writeFile", "write a file", "write")];

/** Fake host; `gate(req)` lets a test hold a call open. */
class FakeHost implements Host {
  calls: HostCallRequest[] = [];
  log: string[] = [];
  gate?: (req: HostCallRequest) => Promise<void> | undefined;
  constructor(public big = "") {}
  async tools() { return DECLS; }
  async call(req: HostCallRequest, _ctx: CallCtx) {
    this.calls.push(req);
    this.log.push(`start ${req.name}`);
    await this.gate?.(req);
    this.log.push(`end ${req.name}`);
    return req.name === "writeFile" ? "written" : this.big || "contents";
  }
  async close() {}
}

type Msg = string | { code: string }[];
/** Scripted model: `script(userText, assistantTurnsSoFar)` decides each reply; instruction text routes concurrent executors. */
function fakeLLM(script: (user: string, turn: number) => Msg) {
  const requests: any[] = [];
  const client: LLMClient = {
    async complete(req) {
      requests.push(req);
      const user = String((req.messages[0] as any).content);
      const turn = req.messages.filter((m: any) => m.role === "assistant").length;
      const s = script(user, turn);
      const message = typeof s === "string"
        ? { role: "assistant", content: s }
        : { role: "assistant", content: null, tool_calls: s.map((p, i) => ({ id: `t${requests.length}_${i}`, type: "function", function: { name: "branch", arguments: JSON.stringify(p) } })) };
      return { response: { choices: [{ message }] }, usage: { input: 10, output: 5 } };
    },
  };
  return { client, requests };
}

const run = (tool: string, code: string) => [{ code: `async (tools, state) => { ${code} }` }];

async function setup(script: (user: string, turn: number) => Msg, opts: { big?: string; variant?: any } = {}) {
  const ws = await mkdtemp(join(tmpdir(), "aiw-orch-"));
  await writeFile(join(ws, "a.ts"), "export function foo() { return 1; }\n");
  const host = new FakeHost(opts.big);
  const registry = buildRegistry(DECLS.map((d) => d), { warn: () => {} });
  const events: EventRecord[] = [];
  const sink: Sink = { write: (e: EventRecord) => void events.push(e) } as Sink;
  const root = createReporter({ sink, writer: "r" });
  const llm = fakeLLM(script);
  const build = (): Framework =>
    buildFramework("orchestrate", registry, {
      host, runtime, variant: opts.variant,
      orchestrate: { client: llm.client, model: "m", workspaceRoot: ws, rerank: "none" },
    });
  const fw = build();
  const tool = (name: string) => fw.tools.find((t) => t.name === name)!;
  const call = () => ({ reporter: root.child("t") });
  return { ws, host, registry, events, llm, fw, build, tool, call };
}

const readOnly = (user: string, turn: number): Msg =>
  turn === 0 ? run("branch", `const t = await tools.readFile({ q: "a.ts" }); return t;`) : "Read it: see @s1.c1.";

test("do end-to-end: report with Step: s1, handoff attached, planner resolve of @s1.c1", async () => {
  const t = await setup(readOnly);
  assert.deepEqual(t.fw.tools.map((x) => x.name), ["do", "resolve"]);
  assert.ok(t.fw.instructions.includes("`do`"));
  const r = await t.tool("do").handle({ instruction: "read a.ts", tools: ["readFile"] }, t.call());
  assert.equal(r.isError, false, r.text);
  assert.match(r.text, /^Read it: see @s1\.c1\./);
  assert.match(r.text, /\nStep: s1$/);
  const handoff = t.events.find((e: any) => e.kind === "attach" && e.key === "orchestrate.handoff") as any;
  assert.ok(handoff, "handoff attached");
  assert.equal((handoff.data ?? handoff).instruction ?? handoff.data?.instruction, "read a.ts");
  assert.equal(t.fw.task!.store.step(1).report, r.text);
  const rr = await t.tool("resolve").handle({ ref: "@s1.c1" }, t.call());
  assert.deepEqual(rr, { text: "contents", isError: false });
  // second do gets s2
  const r2 = await t.tool("do").handle({ instruction: "again with @s1.c1", tools: ["readFile"] }, t.call());
  assert.match(r2.text, /Step: s2$/);
});

test("do selects with BM25 when no override", async () => {
  const t = await setup(readOnly);
  await t.tool("do").handle({ instruction: "read the contents of a file" }, t.call());
  const first = String(t.llm.requests[0].messages[0].content);
  assert.match(first, /readFile\(/);
});

test("invalid reference and unknown tools are isError before any executor turn", async () => {
  const t = await setup(readOnly);
  const bad = await t.tool("do").handle({ instruction: "use @s9 and @nothing" }, t.call());
  assert.equal(bad.isError, true);
  assert.match(bad.text, /Invalid reference/);
  assert.match(bad.text, /Valid references:/);
  const unk = await t.tool("do").handle({ instruction: "x", tools: ["readFile", "nope"] }, t.call());
  assert.equal(unk.isError, true);
  assert.match(unk.text, /nope/);
  assert.equal(t.llm.requests.length, 0);
  assert.equal(t.fw.task!.store.stepCount, 0, "no step id used");
});

test("planner resolve: errors, grep, lines, 4000 char cap", async () => {
  const big = Array.from({ length: 2000 }, (_, i) => `line ${i + 1}`).join("\n");
  const t = await setup(readOnly, { big });
  await t.tool("do").handle({ instruction: "read", tools: ["readFile"] }, t.call());
  const capped = await t.tool("resolve").handle({ ref: "@s1.c1" }, t.call());
  assert.ok(!capped.isError && capped.text.includes("[truncated") && capped.text.length < 4200);
  const g = await t.tool("resolve").handle({ ref: "@s1.c1", grep: "^line 77$" }, t.call());
  assert.equal(g.text, "77: line 77");
  const l = await t.tool("resolve").handle({ ref: "@s1.c1", lines: [2, 3] }, t.call());
  assert.equal(l.text, "line 2\nline 3");
  assert.equal((await t.tool("resolve").handle({ ref: "@s1.c99" }, t.call())).isError, true);
  assert.equal((await t.tool("resolve").handle({ ref: 5 }, t.call())).isError, true);
});

test("a failing executor still ends its step and releases the lock", async () => {
  const t = await setup(() => { throw new Error("llm down"); });
  const r = await t.tool("do").handle({ instruction: "x", tools: ["readFile"] }, t.call());
  assert.equal(r.isError, true);
  assert.match(r.text, /llm down/);
  assert.match(t.fw.task!.store.step(1).report!, /do failed/);
  const again = await t.tool("do").handle({ instruction: "y", tools: ["readFile"] }, t.call());
  assert.match(again.text, /s2/); // lock was released: second call returned
});

/** Resolves when `n` calls are waiting; used to prove concurrency. */
function barrier(n: number) {
  let waiting = 0;
  let open!: () => void;
  const opened = new Promise<void>((r) => (open = r));
  return () => { if (++waiting >= n) open(); return opened; };
}

test("two read-only dos run concurrently (shared lock)", async () => {
  const t = await setup((user, turn) => (turn === 0 ? run("branch", `return await tools.readFile({ q: "x" });`) : "done"));
  const both = barrier(2);
  t.host.gate = () => both(); // each readFile waits until both have started: deadlocks if serialised
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error("serialised")), 3000).unref());
  const rs = await Promise.race([
    Promise.all([
      t.tool("do").handle({ instruction: "A", tools: ["readFile"] }, t.call()),
      t.tool("do").handle({ instruction: "B", tools: ["readFile"] }, t.call()),
    ]),
    timeout,
  ]);
  assert.ok(rs.every((r) => !r.isError), rs.map((r) => r.text).join("|"));
});

test("a write do is exclusive and waits for earlier readers; later readers wait for it (FIFO)", async () => {
  const t = await setup((user, turn) => {
    if (turn > 0) return "done";
    return user.startsWith("W") ? run("branch", `return await tools.writeFile({ q: "o" });`) : run("branch", `return await tools.readFile({ q: "x" });`);
  });
  let releaseReader!: () => void;
  const held = new Promise<void>((r) => (releaseReader = r));
  t.host.gate = (req) => (req.name === "readFile" && !t.host.log.includes("end readFile") ? held : undefined);
  const r1 = t.tool("do").handle({ instruction: "R1", tools: ["readFile"] }, t.call());
  await until(() => t.host.log.includes("start readFile"));
  const w = t.tool("do").handle({ instruction: "W1", tools: ["writeFile"] }, t.call());
  const r2 = t.tool("do").handle({ instruction: "R2", tools: ["readFile"] }, t.call());
  await new Promise((r) => setTimeout(r, 50));
  assert.deepEqual(t.host.log, ["start readFile"], "writer and later reader are waiting");
  releaseReader();
  await Promise.all([r1, w, r2]);
  assert.deepEqual(t.host.log, ["start readFile", "end readFile", "start writeFile", "end writeFile", "start readFile", "end readFile"]);
});

test("findTools adding a write tool upgrades shared to exclusive after other readers finish", async () => {
  const t = await setup((user, turn) => {
    if (turn > 0 && !user.startsWith("A")) return "done";
    if (user.startsWith("A")) {
      if (turn === 0) return run("branch", `return await tools.findTools({ need: "write a file" });`);
      if (turn === 1) return run("branch", `return await tools.writeFile({ q: "o" });`);
      return "done";
    }
    return run("branch", `return await tools.readFile({ q: "x" });`);
  });
  let releaseReader!: () => void;
  const held = new Promise<void>((r) => (releaseReader = r));
  t.host.gate = (req) => (req.name === "readFile" ? held : undefined);
  const b = t.tool("do").handle({ instruction: "B", tools: ["readFile"] }, t.call());
  await until(() => t.host.log.includes("start readFile"));
  const a = t.tool("do").handle({ instruction: "A", tools: ["readFile"] }, t.call());
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(!t.host.log.includes("start writeFile"), "upgrade waits for the reader");
  releaseReader();
  const [rb, ra] = await Promise.all([b, a]);
  assert.ok(!ra.isError && !rb.isError, ra.text);
  assert.ok(t.host.log.indexOf("end readFile") < t.host.log.indexOf("start writeFile"));
  assert.match(ra.text, /Changed:|Step: s2/);
});

async function until(f: () => boolean, ms = 2000) {
  const end = Date.now() + ms;
  while (!f()) {
    if (Date.now() > end) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 5));
  }
}

test("RWLock: FIFO and shared batching", async () => {
  const l = new RWLock();
  const order: string[] = [];
  await l.acquire("shared");
  const w = l.acquire("exclusive").then(() => order.push("w"));
  const r = l.acquire("shared").then(() => order.push("r"));
  await new Promise((x) => setTimeout(x, 10));
  assert.deepEqual(order, []);
  l.release("shared");
  await w;
  assert.deepEqual(order, ["w"]);
  l.release("exclusive");
  await r;
  assert.deepEqual(order, ["w", "r"]);
});

test("orchestrate: state is the task's store proxy; hot paths and executor=calls refuse; needs opts", async () => {
  const t = await setup(readOnly);
  await t.tool("do").handle({ instruction: "read", tools: ["readFile"] }, t.call());
  t.fw.state.note = { a: 1 };
  assert.deepEqual(t.fw.task!.store.getNamed("note").value, { a: 1 });
  assert.throws(() => buildFramework("orchestrate", t.registry, { host: t.host }), /opts\.orchestrate/);
  const o = { client: t.llm.client, model: "m", workspaceRoot: t.ws };
  assert.throws(() => buildFramework("orchestrate", t.registry, { host: t.host, orchestrate: o, variant: { hotPaths: true } }), /hot paths not built yet/);
  assert.throws(() => buildFramework("orchestrate", t.registry, { host: t.host, orchestrate: o, variant: { executor: "calls" } }), /not built yet/);
  assert.throws(() => buildFramework("baseline", t.registry, { host: t.host, variant: { toolSearch: true } }), /toolSearch/);
});

test("fingerprint is stable across builds and differs from branch-only", async () => {
  const t = await setup(readOnly);
  const again = t.build();
  assert.deepEqual(again.fingerprint, t.fw.fingerprint);
  const bo = buildFramework("branch-only", t.registry, { host: t.host });
  assert.notEqual(bo.fingerprint.toolsHash, t.fw.fingerprint.toolsHash);
  const padded = t.build();
  assert.deepEqual(padded.fingerprint, t.fw.fingerprint);
});

test("branch-only[toolSearch]: findTools only at start; found tools stay for the session", async () => {
  const t = await setup(readOnly);
  const fw = buildFramework("branch-only", t.registry, { host: t.host, runtime, variant: { toolSearch: true } });
  const d = fw.tools[0]!.description;
  assert.ok(d.includes("findTools(") && !d.includes("readFile(args"));
  const call = () => t.call();
  const before = await fw.tools[0]!.handle({ code: `async (tools) => { return await tools.readFile({ q: "a" }); }` }, call());
  assert.equal(before.isError, true);
  const found = await fw.tools[0]!.handle({ code: `async (tools) => { return await tools.findTools({ need: "read the contents of a file" }); }` }, call());
  assert.ok(!found.isError, found.text);
  assert.match(found.text, /readFile/);
  const after = await fw.tools[0]!.handle({ code: `async (tools) => { return await tools.readFile({ q: "a" }); }` }, call());
  assert.ok(!after.isError && after.text.includes("contents"), after.text);
  // fingerprint is stable
  assert.deepEqual(buildFramework("branch-only", t.registry, { host: t.host, variant: { toolSearch: true } }).fingerprint, fw.fingerprint);
});

test("catalog=N pads with the fixed distractor set, for any framework", async () => {
  const t = await setup(readOnly);
  const names = (fw: Framework) => fw.tools.map((x) => x.name);
  assert.equal(names(buildFramework("baseline", t.registry, { host: t.host, variant: { catalog: 50 } })).length, 50);
  assert.equal(names(buildFramework("baseline", t.registry, { host: t.host, variant: { catalog: 2 } })).length, 3, "never truncates the real catalog");
  const a = buildFramework("branch-only", t.registry, { host: t.host, variant: { catalog: 40 } });
  const b = buildFramework("branch-only", t.registry, { host: t.host, variant: { catalog: 40 } });
  assert.deepEqual(a.fingerprint, b.fingerprint);
  assert.notEqual(a.fingerprint.toolsHash, buildFramework("branch-only", t.registry, { host: t.host }).fingerprint.toolsHash);
  // fixed: a larger N extends a smaller one; real tools come first
  const p = padRegistry(t.registry, 60);
  assert.deepEqual(p.decls.slice(0, 3).map((d) => d.name), ["readFile", "runTests", "writeFile"]);
  assert.deepEqual(padRegistry(t.registry, 30).decls.map((d) => d.name), p.decls.slice(0, 30).map((d) => d.name));
  assert.equal(new Set(distractorDecls(1000).map((d) => d.name)).size, 1000);
  // distractors are not near-duplicates of real tools
  const warnings: string[] = [];
  buildRegistry([...DECLS, ...distractorDecls(50).map((d) => ({ name: d.name, description: d.description, inputSchema: d.parameters, meta: d.meta }))], { warn: (m) => warnings.push(m) });
  assert.deepEqual(warnings, []);
  // the distractors are not near-duplicates of each other (nor of the real tools) even at N=1000, and the set is a stable prefix
  const big: string[] = [];
  buildRegistry([...DECLS, ...distractorDecls(1000).map((d) => ({ name: d.name, description: d.description, inputSchema: d.parameters, meta: d.meta }))], { warn: (m) => big.push(m) });
  assert.deepEqual(big, []);
  assert.deepEqual(distractorDecls(200), distractorDecls(1000).slice(0, 200));
  // orchestrate selects among the padded catalog and still answers
  const fw = buildFramework("orchestrate", t.registry, { host: t.host, runtime, variant: { catalog: 200 }, orchestrate: { client: t.llm.client, model: "m", workspaceRoot: t.ws, rerank: "none" } });
  const r = await fw.tools[0]!.handle({ instruction: "read the contents of a file" }, t.call());
  assert.ok(!r.isError, r.text);
  assert.match(String(t.llm.requests.at(-2)?.messages[0].content ?? t.llm.requests[0].messages[0].content), /readFile\(/);
});
