import test from "node:test";
import assert from "node:assert/strict";
import { createReporter, type EventRecord, type LLMClient, type Sink } from "@aiw/telemetry";
import { buildRegistry } from "../src/index.ts";
import type { HostToolDecl } from "../src/index.ts";
import { complete, createSelector, llmReranker, noneReranker, parseNames, retrieve } from "../src/orchestrate/selection/index.ts";

const t = (name: string, whenToUse: string, extra: Partial<HostToolDecl> = {}): HostToolDecl => ({
  name, description: whenToUse, inputSchema: {}, meta: { whenToUse, effect: "read" }, ...extra,
});

const catalog = () =>
  buildRegistry(
    [
      t("findSymbol", "find where a symbol or function is defined"),
      t("readFile", "read the contents of a file"),
      t("editFile", "edit a file by replacing text", { meta: { whenToUse: "modify file text", effect: "write", requires: ["readFile", "ghost"] } }),
      t("runTests", "run the test suite"),
      t("webFetch", "download a web page from a url"),
      t("hidden", "find where a symbol is defined", { routing: "direct" }),
    ],
    { warn: () => {} },
  ).decls;

test("retrieve ranks relevant tools first and skips direct tools", () => {
  const r = retrieve("where is the function defined", catalog());
  assert.equal(r[0]!.tool.name, "findSymbol");
  assert.ok(!r.some((x) => x.tool.name === "hidden"));
  assert.ok(!r.some((x) => x.tool.name === "webFetch"));
});

test("retrieve ties break by cost then name; exclude and k apply", () => {
  const c = buildRegistry(
    [
      t("zeta", "alpha gamma", { meta: { whenToUse: "alpha gamma", effect: "read", cost: 1 } }),
      t("beta", "alpha gamma", { meta: { whenToUse: "alpha gamma", effect: "read", cost: 1 } }),
      t("cheap", "alpha gamma", { meta: { whenToUse: "alpha gamma", effect: "read", cost: 0 } }),
    ],
    { warn: () => {} },
  ).decls;
  assert.deepEqual(retrieve("alpha", c).map((x) => x.tool.name).sort(), ["beta", "cheap", "zeta"]);
  const r = retrieve("alpha", c);
  assert.deepEqual(r.map((x) => x.tool.name).slice(0, 3).length, 3);
  assert.equal(r[0]!.tool.name, "cheap");
  assert.equal(r[1]!.tool.name, "beta");
  assert.deepEqual(retrieve("alpha", c, { exclude: new Set(["cheap"]) }).map((x) => x.tool.name), ["beta", "zeta"]);
  assert.equal(retrieve("alpha", c, { k: 1 }).length, 1);
});

test("complete adds requires after the requirer, dedupes, warns on unknown", () => {
  const c = catalog();
  const by = (n: string) => c.find((d) => d.name === n)!;
  const warnings: string[] = [];
  const out = complete([by("editFile"), by("runTests"), by("readFile")], c, (m) => warnings.push(m));
  assert.deepEqual(out.map((d) => d.name), ["editFile", "readFile", "runTests"]);
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /ghost/);
});

test("select truncates to n, completes requires, records stages", async () => {
  const sel = createSelector({ reranker: noneReranker, n: 1 });
  const s = await sel.select({ instruction: "edit file text" }, catalog());
  assert.deepEqual(s.stages.final, ["editFile", "readFile"]);
  assert.equal(s.stages.retrieved[0]!.name, "editFile");
  assert.ok(s.stages.retrieved[0]!.score > 0);
  assert.equal(s.stages.override, undefined);
});

test("override skips retrieval, completes, and rejects unknown names", async () => {
  const sel = createSelector({ reranker: noneReranker });
  const s = await sel.select({ instruction: "x", override: ["editFile"] }, catalog());
  assert.deepEqual(s.tools.map((d) => d.name), ["editFile", "readFile"]);
  assert.equal(s.stages.override, true);
  await assert.rejects(sel.select({ instruction: "x", override: ["nope", "alsoNope"] }, catalog()), /nope, alsoNope/);
});

test("exclude removes tools already present", async () => {
  const sel = createSelector({ reranker: noneReranker });
  const s = await sel.select({ instruction: "find where symbol is defined", exclude: ["findSymbol"] }, catalog());
  assert.ok(!s.stages.final.includes("findSymbol"));
});

function fake(answer: string) {
  const events: EventRecord[] = [];
  const sink: Sink = { write: (e: EventRecord) => void events.push(e) } as Sink;
  const reporter = createReporter({ sink, writer: "r" }).child("sel");
  const reqs: any[] = [];
  const client: LLMClient = {
    async complete(req) {
      reqs.push(req);
      return { response: { choices: [{ message: { content: answer } }] }, usage: { input: 10, output: 2 } };
    },
  };
  return { events, reporter, client, reqs };
}

test("llm reranker orders by the answer, ignores unknown names, reports a selection turn", async () => {
  const f = fake('Sure: ["readFile", "bogus", "findSymbol", "readFile"]');
  const sel = createSelector({ reranker: llmReranker(f.client, { model: "m" }) });
  const s = await sel.select({ instruction: "read file and find symbol defined", reporter: f.reporter }, catalog());
  assert.deepEqual(s.stages.reranked, ["readFile", "findSymbol"]);
  assert.equal(s.stages.rerankFallback, undefined);
  const turns = f.events.filter((e) => e.kind === "turn");
  assert.equal(turns.length, 1);
  assert.equal((turns[0] as any).role, "selection");
  assert.match(f.reqs[0].messages[0].content, /findSymbol/);
});

test("llm reranker falls back to retrieval order on garbage", async () => {
  const f = fake("I cannot help with that!!");
  const sel = createSelector({ reranker: llmReranker(f.client, { model: "m", reporter: f.reporter }) });
  const s = await sel.select({ instruction: "find where symbol is defined" }, catalog());
  assert.equal(s.stages.rerankFallback, true);
  assert.deepEqual(s.stages.reranked, s.stages.retrieved.map((r) => r.name));
  assert.equal(f.events.filter((e) => e.kind === "turn").length, 1);
});

test("parseNames reads arrays and lists", () => {
  assert.deepEqual(parseNames('```json\n["a","b"]\n```'), ["a", "b"]);
  assert.deepEqual(parseNames("1. a\n- b\n"), ["a", "b"]);
  assert.equal(parseNames("!!! ???"), undefined);
});

test("selection forwards cancellation to paid reranking and refuses pre-cancelled selection", async () => {
  const controller = new AbortController();
  const reporter = createReporter({ sink: { write() {} }, writer: "s" });
  let calls = 0;
  const reranker = llmReranker({ complete: async (req) => {
    calls++;
    assert.equal(req.signal, controller.signal);
    controller.abort(new Error("campaign stopped"));
    throw controller.signal.reason;
  } }, { model: "fixture", reporter });
  const selector = createSelector({ reranker });
  await assert.rejects(selector.select({ instruction: "find where a symbol is defined", signal: controller.signal }, catalog()), /campaign stopped/);
  await assert.rejects(selector.select({ instruction: "find where a symbol is defined", signal: controller.signal }, catalog()), /campaign stopped/);
  assert.equal(calls, 1);
});
