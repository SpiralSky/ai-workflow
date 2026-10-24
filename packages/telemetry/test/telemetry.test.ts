import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  BlobStore, FileSink, NoopBlobStore, NoopSink, TranscriptWriter, buildTree, createReporter, currentReporter,
  fromMeta, parseEvents, runWithReporter, reconstruct, rollups, wrapLlm, wrapTools, writeJobEnd, writeJobStart,
  TranscriptEntrySchema, type EventRecord, type Sink, type LlmClient,
} from "../src/index.ts";

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "aiw-tel-"));
class MemSink implements Sink {
  lines: any[] = [];
  write(l: object) { this.lines.push(JSON.parse(JSON.stringify(l))); }
}
const usage = { input: 1, output: 1 };

test("ids are namespaced and the counter is shared across children", () => {
  const s = new MemSink();
  const r = createReporter({ sink: s, writer: "r" });
  const c = r.child("a");
  const g = c.child("b", "x:9");
  assert.equal(r.newId(), "r:2");
  assert.equal(g.scope, "x:9");
  assert.equal(g.newId(), "r:3");
  assert.equal(s.lines[0].kind, "scope");
  assert.equal(s.lines[0].parent, null);
  assert.equal(s.lines[1].parent, "r:1");
  assert.equal(s.lines[1].id, "x:9");
});

test("FileSink writes one line per event; NoopSink still returns ids", () => {
  const f = path.join(tmp(), "e.jsonl");
  const fs1 = new FileSink(f);
  const r = createReporter({ sink: fs1, writer: "r" });
  r.turn({ model: "m", role: "main", usage, latencyMs: 5 });
  r.child("k");
  fs1.close();
  assert.equal(fs.readFileSync(f, "utf8").trim().split("\n").length, 2);
  const n = createReporter({ sink: new NoopSink(), writer: "s" });
  assert.equal(n.turn({ model: "m", role: "main", usage, latencyMs: 1 }), "s:1");
});

test("attach inline vs blob at 64 KB", () => {
  const s = new MemSink();
  const dir = tmp();
  const r = createReporter({ sink: s, writer: "r", blobs: new BlobStore(dir) });
  const mk = (n: number) => "a".repeat(n - 2); // JSON adds 2 quotes
  r.attach("small", mk(65535));
  r.attach("big", mk(65536));
  assert.ok("data" in s.lines[0] && !("blob" in s.lines[0]));
  assert.ok("blob" in s.lines[1] && !("data" in s.lines[1]));
  assert.ok(fs.existsSync(path.join(dir, s.lines[1].blob + ".txt")));
  const s2 = new MemSink();
  createReporter({ sink: s2, writer: "r" }).attach("big", mk(70000));
  assert.ok("data" in s2.lines[0]);
});

test("optional fields are omitted", () => {
  const s = new MemSink();
  const r = createReporter({ sink: s, writer: "r" });
  r.turn({ model: "m", role: "main", usage, latencyMs: 1 });
  r.tool({ name: "t", args: {}, ok: true, durationMs: 1, startTs: 1, resultBytes: 2 });
  for (const k of ["costUsd", "cacheHit"]) assert.ok(!(k in s.lines[0]));
  for (const k of ["error", "harnessId"]) assert.ok(!(k in s.lines[1]));
  assert.ok(!("cachedRead" in s.lines[0].usage));
});

test("harnessId applies to parent-null tool events only when not given", () => {
  const s = new MemSink();
  const r = createReporter({ sink: s, writer: "s", harnessId: "h1" });
  r.toolStart({ id: "s:x", name: "t", args: 1 });
  r.tool({ name: "t", args: 1, ok: true, durationMs: 0, startTs: 0, resultBytes: 1, harnessId: "h2" });
  r.child("c").tool({ name: "t", args: 1, ok: true, durationMs: 0, startTs: 0, resultBytes: 1 });
  assert.equal(s.lines[0].harnessId, "h1");
  assert.equal(s.lines[1].harnessId, "h2");
  assert.ok(!("harnessId" in s.lines[3]));
});

test("job start/end", () => {
  const s = new MemSink();
  const r = createReporter({ sink: s, writer: "r" });
  writeJobStart(r, { job: "j", attempt: 1, framework: "f", problem: "p", rep: 0 });
  writeJobEnd(s, { outcome: "ok" });
  assert.equal(s.lines[0].parent, null);
  assert.equal(s.lines[0].kind, "job");
  assert.equal(s.lines[1].kind, "end");
  assert.ok(!("reason" in s.lines[1]));
  assert.equal(parseEvents(s.lines.map((l) => JSON.stringify(l)).join("\n")).errors.length, 0);
});

test("wrapTools nests inner calls and records errors", async () => {
  const s = new MemSink();
  const r = createReporter({ sink: s, writer: "r" });
  const leafFn = (a: { x: number }) => a.x;
  const outer = wrapTools({
    do: async (_a: unknown) => wrapTools({ leaf: leafFn }, currentReporter()!).leaf({ x: 1 }),
    boom: (_a: unknown) => { throw new Error("bad"); },
  }, r);
  await outer.do({});
  await assert.rejects(() => outer.boom({}), /bad/);
  const tools = s.lines.filter((l) => l.kind === "tool");
  const leaf = tools.find((t) => t.name === "leaf");
  const doT = tools.find((t) => t.name === "do");
  assert.equal(leaf.parent, doT.id);
  assert.equal(doT.parent, null);
  assert.equal(doT.resultBytes, 1);
  const boom = tools.find((t) => t.name === "boom");
  assert.equal(boom.ok, false);
  assert.equal(boom.error, "bad");
  assert.equal(boom.resultBytes, 0);
  assert.ok(!s.lines.some((l) => l.kind === "scope"));
  assert.equal(s.lines.filter((l) => l.kind === "toolStart").length, 3);
});

test("fromMeta scopes to parent and harnessId", () => {
  const s = new MemSink();
  const root = createReporter({ sink: s, writer: "s" });
  const r = fromMeta({ "aiw/parent": "r:7", "aiw/harnessId": "hh" }, root);
  assert.equal(r.scope, "r:7");
  r.tool({ name: "t", args: 0, ok: true, durationMs: 0, startTs: 0, resultBytes: 1 });
  assert.equal(s.lines[0].parent, "r:7");
  assert.equal(s.lines[0].id.startsWith("s:"), true);
  assert.equal(fromMeta(undefined, root).scope, null);
  const h = fromMeta({ "aiw/harnessId": "hh" }, root);
  h.tool({ name: "t", args: 0, ok: true, durationMs: 0, startTs: 0, resultBytes: 1 });
  assert.equal(s.lines[1].harnessId, "hh");
  // ids stay unique across requests: one counter per process
  assert.notEqual(s.lines[0].id, s.lines[1].id);
  // explicit reporter wins over the async-local one
  const ex = createReporter({ sink: s, writer: "r" });
  const t = wrapTools({ t: (_a: unknown) => 1 }, ex.scopedTo("x:1"));
  return runWithReporter(ex.scopedTo("y:1"), async () => {
    await t.t({});
    assert.equal(s.lines.filter((l) => l.kind === "tool").at(-1).parent, "x:1");
  });
});

test("wrapLlm writes turn and transcript entry with matching turnId", async () => {
  const ev = new MemSink();
  const tr = new MemSink();
  const r = createReporter({ sink: ev, writer: "r" });
  const client: LlmClient = { complete: async () => ({ response: { ok: 1 }, usage: { input: 3, output: 4 }, costUsd: 0.01 }) };
  const w = wrapLlm(client, r, "main", { transcript: new TranscriptWriter({ sink: tr, blobs: new NoopBlobStore() }), session: "main" });
  await w.complete({ model: "m", system: "sys", tools: [{ b: 1, a: 2 }], messages: [{ role: "user" }] });
  assert.equal(ev.lines[0].kind, "turn");
  assert.equal(ev.lines[0].model, "m");
  assert.equal(tr.lines[0].turnId, ev.lines[0].id);
  assert.equal(TranscriptEntrySchema.safeParse(tr.lines[0]).success, true);
});

test("transcript delta, reset, reconstruct", () => {
  const sink = new MemSink();
  const t = new TranscriptWriter({ sink, blobs: new NoopBlobStore() });
  const msgs: unknown[] = [{ n: 1 }];
  const base = { session: "main", system: "s", tools: [], response: {} };
  t.record({ ...base, turnId: "a", messages: msgs });
  msgs.push({ n: 2 }, { n: 3 }); // mutate caller array: snapshot must be unaffected
  t.record({ ...base, turnId: "b", messages: msgs });
  t.record({ ...base, turnId: "c", messages: [{ n: 9 }] });
  t.record({ ...base, session: "other", turnId: "d", messages: [{ z: 1 }] });
  const e = sink.lines;
  assert.deepEqual(e[1].append, [{ n: 2 }, { n: 3 }]);
  assert.equal(e[1].reset, undefined);
  assert.equal(e[2].reset, true);
  assert.equal(e[2].seq, 3);
  assert.equal(e[3].seq, 1);
  assert.deepEqual(reconstruct(e, "main"), [[{ n: 1 }], [{ n: 1 }, { n: 2 }, { n: 3 }], [{ n: 9 }]]);
});

test("blob store is idempotent (O_EXCL) and canonical", () => {
  const dir = tmp();
  const b = new BlobStore(dir);
  const h = b.put("hello");
  assert.equal(b.put("hello"), h);
  assert.equal(fs.readFileSync(path.join(dir, h + ".txt"), "utf8"), "hello");
  assert.equal(b.putJson({ b: 1, a: { d: 1, c: 2 } }), b.putJson({ a: { c: 2, d: 1 }, b: 1 }));
  assert.equal(new NoopBlobStore().put("hello"), h);
});

const base = { v: 1 as const, ts: 0 };
const turn = (id: string, parent: string | null, role: "main" | "secondary" | "selection", extra: object = {}): EventRecord =>
  ({ ...base, kind: "turn", id, parent, model: "m", role, usage: { input: 10, output: 5 }, costUsd: 0.1, latencyMs: 100, ...extra }) as EventRecord;
const tool = (id: string, parent: string | null, name: string, d = 10): EventRecord =>
  ({ ...base, kind: "tool", id, parent, name, args: {}, ok: true, durationMs: d, startTs: 0, resultBytes: 1 }) as EventRecord;

test("buildTree handles out-of-order and orphans", () => {
  const evs = [tool("c", "p", "leaf"), tool("p", null, "do"), tool("o", "ghost", "x")];
  const root = buildTree(evs);
  assert.equal(root.children.length, 2);
  const p = root.children.find((n) => n.event!.id === "p")!;
  assert.equal(p.children[0]!.event!.id, "c");
  const o = root.children.find((n) => n.event!.id === "o")!;
  assert.equal(o.orphan, true);
  // toolStart + tool with the same id collapse to the tool
  const ts = { ...base, kind: "toolStart", id: "p", parent: null, name: "do", args: {} } as EventRecord;
  const r2 = buildTree([ts, tool("p", null, "do")]);
  assert.equal(r2.children.length, 1);
  assert.equal(r2.children[0]!.event!.kind, "tool");
});

test("rollups", () => {
  const evs: EventRecord[] = [
    turn("t1", null, "main", { usage: { input: 10, output: 5, cachedRead: 4 } }),
    tool("do1", null, "do", 50),
    turn("t2", "do1", "secondary"),
    tool("n1", "do1", "grep", 7),
    tool("n2", "do1", "edit", 3),
    turn("t3", "n1", "selection"),
    tool("top2", null, "renameSymbol", 20),
    tool("ext", null, "webSearch", 5),
  ];
  const r = rollups(evs, { externalTools: ["webSearch"], refactorTools: ["renameSymbol"] });
  assert.ok(Math.abs(r.costUsd! - 0.3) < 1e-9);
  assert.equal(r.mainTurns, 1);
  assert.equal(r.secondaryTurns, 2);
  assert.equal(r.topLevelToolCalls, 3);
  assert.equal(r.leafToolCalls, 4);
  assert.deepEqual(r.tokens.main, { input: 10, output: 5, cachedRead: 4 });
  assert.deepEqual(r.tokens.secondary, { input: 10, output: 5 });
  assert.equal(r.toolTimeMs, 75);
  assert.equal(r.modelTimeMs, 300);
  assert.equal(r.callsPerTool.do, 1);
  assert.equal(r.externalCalls, 1);
  assert.deepEqual(r.editCalls, { refactor: 1, manual: 1 });
  const noCost = rollups([turn("a", null, "main"), { ...turn("b", null, "main"), costUsd: undefined } as EventRecord], { externalTools: [], refactorTools: [] });
  assert.equal(noCost.costUsd, null);
});

test("parseEvents tolerates a truncated last line", () => {
  const good = JSON.stringify(tool("a", null, "x"));
  const r = parseEvents(good + "\n" + good.slice(0, 20));
  assert.equal(r.events.length, 1);
  assert.equal(r.errors.length, 0);
  assert.equal(r.truncatedTail, true);
  const bad = parseEvents(good + "\nnot json\n" + good + "\n");
  assert.equal(bad.events.length, 2);
  assert.equal(bad.errors.length, 1);
});

test("two writers appending to one file stay parseable", () => {
  const f = path.join(tmp(), "e.jsonl");
  const a = createReporter({ sink: new FileSink(f), writer: "r" });
  const b = createReporter({ sink: new FileSink(f), writer: "s", parent: "r:1" });
  for (let i = 0; i < 200; i++) {
    a.turn({ model: "m", role: "main", usage, latencyMs: 1 });
    b.tool({ name: "t", args: { pad: "x".repeat(500) }, ok: true, durationMs: 1, startTs: 1, resultBytes: 1 });
  }
  const r = parseEvents(fs.readFileSync(f, "utf8"));
  assert.equal(r.events.length, 400);
  assert.equal(r.errors.length, 0);
  assert.equal(new Set(r.events.map((e) => e.id)).size, 400);
});
