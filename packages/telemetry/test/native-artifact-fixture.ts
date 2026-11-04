import { mkdtempSync, mkdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createNativeEventSink } from "../../../scripts/native-interactive/native-events.mjs";

/** Produce and retain actual native sink envelopes, including a non-turn event with no usage marker. */
export function nativeArtifactFixture() {
  const root = process.env.NATIVE_TEST_EVIDENCE ?? join(tmpdir(), "aiw-native-test-evidence");
  mkdirSync(root, { recursive: true });
  const cellDir = mkdtempSync(join(root, "native-artifact-"));
  const binding = { sourceSHA256: "a".repeat(64), admissionSHA256: "b".repeat(64), cellId: "synthetic", arm: "orchestrate-off", limitsSHA256: "c".repeat(64) };
  const sink = createNativeEventSink({ cellDir, binding, onFatal: error => { throw error; },
    completionEvidence: () => ({ version: "native-completion-evidence-v1", binding, attempts: 0, accepted: [], files: [], summary: {}, input: null, output: null, costUsd: null }) });
  sink.write({ v: 1, id: "s:1", parent: null, ts: 1, kind: "scope", label: "synthetic no-model scope" });
  sink.close();
  return {
    cellDir,
    event: readFileSync(join(cellDir, "native-event-000001.jsonl"), "utf8"),
    summary: readFileSync(join(cellDir, "native-events-summary.jsonl"), "utf8"),
  };
}
