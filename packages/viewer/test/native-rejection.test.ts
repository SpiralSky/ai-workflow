import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadScript } from "../src/data/loader.ts";
const indexer = fileURLToPath(new URL("../indexer/index.ts", import.meta.url));
const native = { v: 1, id: "s:1", parent: null, ts: 1, kind: "turn", model: "native", role: "secondary", latencyMs: 1,
  usage: null, usageStatus: "unavailable", usageReason: "native-harness-unreported",
  completionEvidence: { completionId: "fixture", requestSHA256: "a".repeat(64), responseSHA256: "b".repeat(64) } };
/** Retain synthesized inputs and complete CLI output; never read default runs or delete evidence. */
function fixture() {
  const evidenceRoot = process.env.NATIVE_TEST_EVIDENCE ?? join(tmpdir(), "aiw-native-test-evidence");
  mkdirSync(evidenceRoot, { recursive: true });
  const root = mkdtempSync(join(evidenceRoot, "native-viewer-")), runs = join(root, "runs"), run = join(runs, "fixture"), job = join(run, "p.baseline.0"), out = join(root, "out");
  mkdirSync(job, { recursive: true });
  writeFileSync(join(run, "run.json"), JSON.stringify({ format: 1, id: "fixture", config: { frameworks: ["baseline"], problems: ["p"], models: {} }, totals: { jobs: 1, pass: 1, fail: 0, costUsd: 1, attempts: 1 }, provenance: {} }));
  writeFileSync(join(job, "job.json"), JSON.stringify({ format: 1, problem: "p", framework: "baseline", rep: 0, outcome: "pass", attempts: [{ n: 0 }], costUsdAllAttempts: 1, durationMs: 1 }));
  writeFileSync(join(job, "events.jsonl"), "");
  return { run, job, out, execute: () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", indexer, "--runs-dir", runs, "--out-dir", out], { encoding: "utf8" });
    writeFileSync(join(root, "indexer.stdout.log"), result.stdout ?? "");
    writeFileSync(join(root, "indexer.stderr.log"), result.stderr ?? "");
    writeFileSync(join(root, "indexer-result.json"), JSON.stringify({ status: result.status, signal: result.signal, error: result.error?.message }) + "\n");
    return result;
  } };
}
for (const target of ["run", "job", "events", "envelope"] as const) test(`viewer indexer rejects native ${target} rather than skipping or reporting zero`, t => {
  const f = fixture();
  const path = target === "run" ? join(f.run, "run.json") : target === "job" ? join(f.job, "job.json") : join(f.job, "events.jsonl");
  writeFileSync(path, JSON.stringify(target === "events" ? native : { format: target === "envelope" ? "native-orchestrate-event-v1" : "native-orchestrate-evidence-v1" }) + "\n");
  const result = f.execute();
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Unsupported native format/);
  assert.equal(existsSync(join(f.out, "index.js")), false);
});
test("viewer indexer numeric input remains accepted", t => {
  const f = fixture(), result = f.execute();
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(join(f.out, "index.js"), "utf8"), /"costUsd":1/);
});
test("browser loader rejects native registered and cached data without hanging", async () => {
  const globals = globalThis as any;
  const old = { window: globals.window, document: globals.document, CSS: globals.CSS };
  globals.window = {};
  globals.CSS = { escape: (value: string) => value };
  globals.document = { querySelector: () => null, createElement: () => ({ dataset: {} }), head: { appendChild: () => {} } };
  try {
    const pending = loadScript("fixture.js", "native-register");
    const rejected = assert.rejects(pending, /Unsupported native format/);
    globals.window.__aiw.register("native-register", { events: [native] });
    await rejected;
    assert.equal(globals.window.__aiw._data.has("native-register"), false);
    await assert.rejects(loadScript("fixture.js", "native-register"), /Unsupported native format/);
    const { nativeArtifactFixture } = await import("../../telemetry/test/native-artifact-fixture.ts");
    const artifacts = nativeArtifactFixture();
    for (const [name, raw] of Object.entries({ event: artifacts.event, summary: artifacts.summary })) {
      const key = `actual-sink-${name}`;
      const pending = loadScript("fixture.js", key);
      const rejected = assert.rejects(pending, /Unsupported native format/);
      globals.window.__aiw.register(key, JSON.parse(raw));
      await rejected;
      assert.equal(globals.window.__aiw._data.has(key), false);
    }
    globals.window.__aiw._data.set("native-cache", { runs: [{ format: "native-orchestrate-evidence-v1" }] });
    await assert.rejects(loadScript("fixture.js", "native-cache"), /Unsupported native format/);
    const numeric = loadScript("fixture.js", "numeric-register");
    globals.window.__aiw.register("numeric-register", { runs: [{ format: 1 }] });
    assert.deepEqual(await numeric, { runs: [{ format: 1 }] });
  } finally { Object.assign(globals, old); }
});

test("viewer indexer rejects actual sink non-turn envelope and summary", async () => {
  const { nativeArtifactFixture } = await import("../../telemetry/test/native-artifact-fixture.ts");
  const artifacts = nativeArtifactFixture();
  for (const raw of [artifacts.event, artifacts.summary]) {
    const f = fixture();
    writeFileSync(join(f.job, "events.jsonl"), raw);
    const result = f.execute();
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported native format/);
    assert.equal(existsSync(join(f.out, "index.js")), false);
  }
});
