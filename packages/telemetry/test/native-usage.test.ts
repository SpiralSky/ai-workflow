import test from "node:test";
import assert from "node:assert/strict";
import { createReporter, wrapLLM, EventSchema, NativeCompletionSchema, parseEvents, buildTree, rollups, rejectNativeFormat, type NativeLLMCompletion, type EventRecord } from "../src/index.ts";
const completion: NativeLLMCompletion = { response: { choices: [{ message: { content: "fixture" } }] }, usage: null,
  usageStatus: "unavailable", usageReason: "native-harness-unreported", completionEvidence: {
    completionId: "fixture-completion", requestSHA256: "a".repeat(64), responseSHA256: "b".repeat(64),
  } };
test("native roles and trusted receipt metadata survive wrapper, reporter and schema", async () => {
  const events: EventRecord[] = [];
  const reporter = createReporter({ writer: "s", sink: { write: e => events.push(EventSchema.parse(e)) } });
  for (const role of ["selection", "secondary"] as const) {
    const client = wrapLLM({ complete: async () => completion }, reporter, role);
    assert.deepEqual(await client.complete({ model: "native-label", system: "", tools: [], messages: [] }), completion);
  }
  assert.deepEqual(events.map(e => e.kind === "turn" ? e.role : null), ["selection", "secondary"]);
  for (const event of events) {
    assert.equal(event.kind, "turn");
    if (event.kind !== "turn") throw new Error("turn missing");
    assert.equal(event.usage, null);
    assert.equal(event.usageStatus, "unavailable");
    assert.deepEqual(event.completionEvidence, completion.completionEvidence);
    for (const key of ["costUsd", "cacheHit", "deepseekEstimate", "providerModel"]) assert.equal(Object.hasOwn(event, key), false);
  }
  assert.throws(() => parseEvents(events.map(e => JSON.stringify(e)).join("\n")), /Unsupported native format/);
  assert.throws(() => buildTree(events), /Unsupported native format/);
  assert.throws(() => rollups(events, { externalTools: [], refactorTools: [] }), /Unsupported native format/);
});
for (const field of ["costUsd", "cacheHit", "deepseekEstimate", "cachedRead", "inputTokens"]) test(`native completion rejects forged ${field}`, () => {
  assert.equal(NativeCompletionSchema.safeParse({ ...completion, [field]: 0 }).success, false);
});
for (const format of ["native-orchestrate-event-v1", "native-orchestrate-evidence-v1", "native-completion-response-v1"]) test(`standard parser rejects ${format}, not empty success`, () => {
  assert.throws(() => parseEvents(JSON.stringify({ format }) + "\n"), /Unsupported native format/);
});

test("standard parser rejects actual sink non-turn envelope and evidence summary", async () => {
  const { nativeArtifactFixture } = await import("./native-artifact-fixture.ts");
  const artifacts = nativeArtifactFixture();
  for (const raw of [artifacts.event, artifacts.summary]) {
    assert.throws(() => parseEvents(raw), /Unsupported native format/);
  }
});


test("synthetic coordinator wrappers reject reserved native metadata without scanning tool payloads", () => {
  const submission = { nativeCompletion: { completion: { version: "native-completion-evidence-v1" }, event: { version: "native-orchestrate-evidence-v1" } } };
  for (const record of [submission, { kind: "final-submission", submission }, { completionLane: { closeEvidence: submission.nativeCompletion } }]) {
    assert.throws(() => rejectNativeFormat(record), /Unsupported native format/);
    assert.throws(() => parseEvents(JSON.stringify(record) + "\n"), /Unsupported native format/);
  }
  const arbitrary = { nativeCompletion: {}, completionLane: {}, version: "native-orchestrate-event-v1" };
  for (const record of [
    { v: 1, kind: "tool", args: arbitrary },
    { v: 1, kind: "attach", data: arbitrary },
    { response: arbitrary, messages: [arbitrary], transcript: arbitrary },
    { kind: "final-submission", submission: { ordinary: true } },
  ]) assert.doesNotThrow(() => rejectNativeFormat(record));
});
