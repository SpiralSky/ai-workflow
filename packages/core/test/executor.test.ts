import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createReporter, type EventRecord, type LLMClient, type Sink } from "@aiw/telemetry";
import { buildRegistry, RefStore } from "../src/index.ts";
import type { CallCtx, Host, HostCallRequest, HostToolDecl } from "../src/index.ts";
import { ChangeTracker } from "../src/orchestrate/changes.ts";
import { executorBranchDescription, LAST_TURN_NOTICE, runExecutor, type ExecutorInput } from "../src/orchestrate/executor.ts";
import { createSelector, noneReranker } from "../src/orchestrate/selection/index.ts";
import { loadPrompt } from "../src/framework/prompts.ts";
import { runtime } from "./engine.ts";

const decl = (name: string, whenToUse: string, effect: "read" | "write" | "exec" = "read"): HostToolDecl => ({
  name, description: whenToUse, inputSchema: { type: "object", properties: { q: { type: "string" } } }, meta: { whenToUse, effect },
});

class FakeHost implements Host {
  calls: HostCallRequest[] = [];
  constructor(public ws: string, public bigResult = "") {}
  async tools() {
    return [decl("readFile", "read the contents of a file"), decl("runTests", "run the test suite", "exec"), decl("writeFile", "write a file", "write")];
  }
  async call(req: HostCallRequest, _ctx: CallCtx) {
    this.calls.push(req);
    const a = req.args as { q?: string };
    if (req.name === "writeFile") {
      await writeFile(join(this.ws, a.q ?? "out.txt"), "data");
      return "written";
    }
    if (req.name === "runTests") return { exitCode: 1, out: "FAIL x" };
    return this.bigResult || "contents";
  }
  async close() {}
}

/** A scripted model: each entry is a text reply or a list of branch programs (one tool call each). */
type Step = string | { code: string }[];
function scripted(steps: Step[]) {
  const requests: any[] = [];
  const client: LLMClient = {
    async complete(req) {
      requests.push({ ...req, messages: [...req.messages] });
      const s = steps[requests.length - 1] ?? "(script ended)";
      const message =
        typeof s === "string"
          ? { role: "assistant", content: s }
          : { role: "assistant", content: null, tool_calls: s.map((p, i) => ({ id: `t${requests.length}_${i}`, type: "function", function: { name: "branch", arguments: JSON.stringify(p) } })) };
      return { response: { choices: [{ message }] }, usage: { input: 10, output: 5 } };
    },
  };
  return { client, requests };
}

async function setup(steps: Step[], opts: { shortlist?: string[]; turns?: number; bigResult?: string; instruction?: string; setupStore?: (s: RefStore) => void; reportMaxChars?: number } = {}) {
  const ws = await mkdtemp(join(tmpdir(), "aiw-exec-"));
  await writeFile(join(ws, "a.ts"), "export function foo() { return 1; }\n");
  const host = new FakeHost(ws, opts.bigResult);
  const registry = buildRegistry(await host.tools(), { warn: () => {} });
  const store = new RefStore();
  opts.setupStore?.(store);
  const instruction = opts.instruction ?? "read a.ts";
  const step = store.startStep({ instruction, executor: "m" });
  const events: EventRecord[] = [];
  const sink: Sink = { write: (e: EventRecord) => void events.push(e) } as Sink;
  const reporter = createReporter({ sink, writer: "r" }).child("do");
  const selector = createSelector({ reranker: noneReranker });
  const names = opts.shortlist ?? ["readFile"];
  const selection = { tools: names.map((n) => registry.byName.get(n)!), stages: { retrieved: names.map((n) => ({ name: n, score: 1 })), final: names } };
  const llm = scripted(steps);
  const added: string[][] = [];
  const input: ExecutorInput = {
    instruction, step, doEventId: "r:9", store, tracker: new ChangeTracker(ws), reporter, client: llm.client, model: "m",
    registry, host, reader: { readFile: (p) => readFile(join(ws, p), "utf8") }, runtime, selection, selector,
    limits: { turns: opts.turns, reportMaxChars: opts.reportMaxChars },
    onAddTools: async (t) => void added.push(t.map((d) => d.name)),
  };
  return { input, store, host, llm, events, added, ws, run: () => runExecutor(input) };
}

const prog = (code: string) => [{ code }];

test("happy path: one branch program, then the report with framework lines", async () => {
  const t = await setup([prog(`async (tools, state) => { const t = await tools.readFile({ q: "a.ts" }); state.found = t; return t; }`), "Read it: see @s1.c1."]);
  const r = await t.run();
  assert.equal(r.turns, 2);
  assert.equal(r.exhausted, false);
  assert.match(r.report, /^Read it: see @s1\.c1\./);
  assert.match(r.report, /\nChanged: none\n/);
  assert.match(r.report, /\nSaved: @found — string, /);
  assert.ok(r.report.endsWith("\nStep: s1"));
  assert.ok(!r.report.includes("Budget:"));
  // first request: one fixed branch tool, static system, user message order
  const req = t.llm.requests[0];
  assert.equal(req.system, loadPrompt("executor"));
  assert.equal(req.tools.length, 1);
  assert.equal(req.tools[0].function.name, "branch");
  assert.equal(req.tools[0].function.description, executorBranchDescription());
  for (const m of ["findTools", "resolve", "save", "refSymbol"]) assert.ok(executorBranchDescription().includes(m + "(args"));
  assert.ok(!executorBranchDescription().includes("readFile(args"));
  const user: string = req.messages[0].content;
  const order = ["read a.ts", "This is step s1", "You have 4 turns.", "readFile(args"].map((s) => user.indexOf(s));
  assert.ok(order.every((x) => x >= 0) && order.every((x, i) => i === 0 || x > order[i - 1]!), user);
  assert.ok(user.trimEnd().endsWith("```"));
  // second request carries the trace as a tool message
  const second = t.llm.requests[1].messages;
  assert.equal(second[second.length - 1].role, "tool");
  assert.match(second[second.length - 1].content, /readFile/);
  // turns are secondary
  const turns = t.events.filter((e) => e.kind === "turn") as any[];
  assert.equal(turns.length, 2);
  assert.ok(turns.every((e) => e.role === "secondary"));
});

test("last-turn notice goes in before the last allowed turn only", async () => {
  const t = await setup([prog(`async () => 1`), prog(`async () => 2`), "done"], { turns: 3 });
  await t.run();
  const lastMsg = (i: number) => t.llm.requests[i].messages.at(-1);
  assert.notEqual(lastMsg(0).content, LAST_TURN_NOTICE);
  assert.notEqual(lastMsg(1).content, LAST_TURN_NOTICE);
  assert.deepEqual(lastMsg(2), { role: "user", content: LAST_TURN_NOTICE });
});

test("cap exhaustion: still calling tools on the last turn gives Budget: exhausted", async () => {
  const t = await setup([prog(`async () => 1`), prog(`async () => 2`)], { turns: 2 });
  const r = await t.run();
  assert.equal(r.turns, 2);
  assert.equal(r.exhausted, true);
  assert.match(r.report, /\nBudget: exhausted\n/);
  assert.match(r.report, /No report/);
  assert.deepEqual(r.handoff.budget, { turns: 2, used: 2, exhausted: true });
  assert.equal(t.llm.requests.length, 2);
});

test("findTools escalation adds tools, calls onAddTools first, logs the miss", async () => {
  const t = await setup(
    [
      prog(`async (tools) => await tools.findTools({ need: "run the test suite" })`),
      prog(`async (tools) => await tools.runTests({})`),
      "tests fail",
    ],
    { shortlist: ["readFile"] },
  );
  const r = await t.run();
  assert.deepEqual(t.added, [["runTests"]]);
  const toolMsg = t.llm.requests[1].messages.at(-1).content as string;
  assert.match(toolMsg, /runTests\(args/);
  assert.deepEqual(t.host.calls.map((c) => c.name), ["runTests"]);
  assert.deepEqual(r.handoff.selection.escalations, [{ kind: "escalation", need: "run the test suite", tools: ["runTests"] }]);
  assert.deepEqual(r.handoff.selection.shortlist, ["readFile"]);
  assert.deepEqual([1, 2].map((k) => t.store.call(1, k).tool), ["findTools", "runTests"]);
});

test("inner calls are stored as sN.cK in call order with full uncapped results", async () => {
  const big = "z".repeat(20000);
  const t = await setup(
    [
      prog(`async (tools) => { const a = await tools.readFile({ q: "a.ts" }); const b = await tools.runTests({}); return [a.length, b.exitCode]; }`),
      prog(`async (tools) => await tools.readFile({ q: "b" })`),
      "ok",
    ],
    { shortlist: ["readFile", "runTests"], bigResult: big },
  );
  await t.run();
  assert.equal(t.store.callCount(1), 3);
  const [c1, c2, c3] = [1, 2, 3].map((k) => t.store.call(1, k));
  assert.equal(c1!.tool, "readFile");
  assert.equal((c1!.result as string).length, 20000);
  assert.deepEqual(c1!.args, { q: "a.ts" });
  assert.equal(c2!.tool, "runTests");
  assert.deepEqual(c2!.outcome, { ok: false, exitCode: 1 });
  assert.equal(c3!.tool, "readFile");
  assert.equal(c3!.k, 3);
  // the program saw the capped result, not the stored one
  assert.ok(t.host.calls.length === 3);
});

test("failed inner calls are stored with the error", async () => {
  const t = await setup([prog(`async (tools) => await tools.resolve({ ref: "@s7" })`), "failed"]);
  await t.run();
  const c = t.store.call(1, 1);
  assert.equal(c.tool, "resolve");
  assert.equal(c.outcome.ok, false);
  assert.match(c.outcome.error!, /no step 7/);
});

test("save and refSymbol write named values; Saved: lists them; unchanged names are not re-saved", async () => {
  const t = await setup(
    [
      prog(`async (tools, state) => { await tools.save({ name: "failing", value: ["t1", "t2"], summary: "2 failing tests" }); state.fn = await tools.refSymbol({ file: "a.ts", name: "foo" }); return state.fn; }`),
      "saved @failing and @fn",
    ],
    { setupStore: (s) => { s.startStep({ instruction: "earlier" }); s.setNamed("old", 1, 1, "old value"); } },
  );
  // step 1 is "earlier"; the executor's step is 2
  t.input.step = 2;
  const r = await t.run();
  assert.match(r.report, /Saved: @failing — 2 failing tests\n {7}@fn — live, a\.ts#foo\n/);
  assert.ok(!r.report.includes("@old —"));
  assert.deepEqual(t.store.getNamed("failing").value, ["t1", "t2"]);
  const fn = t.store.getNamed("fn");
  assert.equal(fn.kind, "live");
  assert.match((fn.value as any).version, /^[0-9a-f]{40}$/);
  assert.equal(t.store.history("old").length, 1);
  assert.match(r.report, /Step: s2$/);
});

test("invalid report reference: one repair turn counted against the cap", async () => {
  const t = await setup([prog(`async (tools) => await tools.readFile({ q: "a.ts" })`), "see @nowhere", "see @s1.c1 instead"]);
  const r = await t.run();
  assert.equal(r.turns, 3);
  assert.match(r.report, /^see @s1\.c1 instead/);
  const repairReq = t.llm.requests[2].messages.at(-1);
  assert.equal(repairReq.role, "user");
  assert.match(repairReq.content, /@nowhere/);
  assert.match(repairReq.content, /Valid references/);
});

test("still-invalid reference after repair is replaced with [invalid ref: …]", async () => {
  const t = await setup([prog(`async () => 1`), "see @nowhere", "now @alsoGone"]);
  const r = await t.run();
  assert.match(r.report, /^now \[invalid ref: @alsoGone: no value named "alsoGone"\]/);
  assert.ok(!r.report.includes("@alsoGone ") );
});

test("no budget left: invalid references are replaced without a repair turn", async () => {
  const t = await setup(["see @s9.c1"], { turns: 1 });
  const r = await t.run();
  assert.equal(r.turns, 1);
  assert.equal(t.llm.requests.length, 1);
  assert.match(r.report, /^see \[invalid ref: @s9\.c1: no step 9\]/);
});

test("model text is capped at 2000 chars with a note; footer lines follow", async () => {
  const t = await setup(["word ".repeat(1000)]);
  const r = await t.run();
  const [body] = r.report.split("\nChanged:");
  assert.match(body!, /\[report truncated: showing \d+ of 4999 chars/);
  assert.ok(body!.indexOf("\n… [report truncated") <= 2000);
  assert.match(r.report, /\nChanged: none\nStep: s1$/);
});

test("Changed: lists paths written during the step", async () => {
  const t = await setup([prog(`async (tools) => { await tools.writeFile({ q: "new.txt" }); }`), "wrote it"], { shortlist: ["writeFile"] });
  const r = await t.run();
  assert.match(r.report, /\nChanged: new\.txt \(added\)\n/);
  assert.deepEqual(r.changed, { added: ["new.txt"], modified: [], deleted: [] });
});

test("handoff record has exactly the §8.4 fields; references and hot paths are recorded", async () => {
  const t = await setup(["done"], {
    instruction: "use @prior and check @s1",
    setupStore: (s) => {
      s.startStep({ instruction: "first" });
      s.finishStep(1, { report: "r1" });
      s.setNamed("prior", { a: 1 }, 1, "prior value");
    },
  });
  t.input.step = t.store.startStep({ instruction: "use @prior and check @s1" });
  t.input.hotPaths = [{ id: "hp1", description: "widen search", tools: ["readFile"], outcome: "empty-result", code: "async (tools) => 1" }];
  t.input.override = ["readFile"];
  const r = await t.run();
  assert.deepEqual(Object.keys(r.handoff).sort(), ["budget", "hotPaths", "instruction", "model", "references", "selection"]);
  assert.equal(r.handoff.instruction, "use @prior and check @s1");
  assert.deepEqual(r.handoff.hotPaths, ["hp1"]);
  assert.equal(r.handoff.model, "m");
  assert.deepEqual(r.handoff.selection.override, ["readFile"]);
  assert.deepEqual(r.handoff.selection.stages.final, ["readFile"]);
  const refs = r.handoff.references;
  assert.deepEqual(refs.map((x) => [x.ref, x.mode, x.step]), [["@prior", "inline", 1], ["@s1", "inline", 1]]);
  assert.match(refs[0]!.received, /"a": 1/);
  const user: string = t.llm.requests[0].messages[0].content;
  assert.ok(user.includes("Known-good patterns") && user.includes("hp1"));
  assert.ok(user.includes("@prior (from step 1)"));
});

test("variant calls is not built yet", async () => {
  const t = await setup(["x"]);
  t.input.variant = "calls";
  await assert.rejects(t.run(), /not built yet/);
});
