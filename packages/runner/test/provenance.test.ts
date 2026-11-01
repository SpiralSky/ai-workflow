import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { DEFAULT_BRANCH_CONFIG, gitProvenance } from "../src/config.ts";
import { collectStaticProvenance, verifyStaticProvenance, hashText, hashTree, problemHash, attestJob, assertCompleteProvenance, inspectContainerImage } from "../src/provenance.ts";
import { gradeJob } from "../src/grade.ts";
import type { RunConfig, Provenance } from "../src/types.ts";
import type { MCPSession } from "../src/mcp.ts";

const digest = "a".repeat(64), image = `sha256:${digest}`;
/** Local source/task fixture, never a model call or actual container. */
function fixture(t: TestContext) {
  const root = mkdtempSync(join(tmpdir(), "aiw-provenance-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const put = (name: string, data: string) => {
    const path = join(root, name); mkdirSync(join(path, ".."), { recursive: true }); writeFileSync(path, data);
  };
  put("package.json", "{}"); put("package-lock.json", "{}");
  put("packages/server/src/index.ts", "source"); put("packages/server/dist/aiw-server.mjs", "bundle");
  put("packages/server/dist/node_modules/native/prebuild.node", "native bytes");
  for (const name of ["base", "branch-only", "branch-tool", "do-tool", "executor", "orchestrate", "rerank", "resolve-tool"]) put(`packages/server/dist/prompts/${name}.md`, `prompt-${name}`);
  put("experiments/problems/p/task.json", JSON.stringify({ turnLimit: 2 }));
  put("experiments/problems/p/task.md", "task prompt");
  put("experiments/problems/p/workspace/main.py", "source");
  put("experiments/problems/p/checks/check.sh", "hidden-check-contents");
  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["add", "."], { cwd: root });
  execFileSync("git", ["-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "-qm", "fixture"], { cwd: root });
  const config: RunConfig = { kind: "dev", problems: ["p"], frameworks: ["baseline"], tier: "S", reps: 1, budgetUsd: 1,
    concurrency: 1, models: { main: "requested-alias", secondary: "requested-alias" }, temperature: 0, secondaryCap: 4, branch: DEFAULT_BRANCH_CONFIG };
  const base = { ...gitProvenance(root), runnerVersion: "fixture", engine: "pending", basePrompt: hashText("prompt-base") };
  const provenance = collectStaticProvenance(root, config, base, () => {});
  return { root, put, config, base, provenance };
}
/** Server response fixture reports observations, not requested identity strings. */
function session(provenance: Provenance): MCPSession {
  return { tools: [{ name: "read", inputSchema: {} }], instructions: "", _client: {} as any,
    runtimeProvenance: { version: 1, engine: "isolated-vm", entryHash: provenance.integrity!.entryHash, nodeVersion: "v22.0.0", runtimePlatform: { platform: "linux", arch: "x64", moduleABI: "127" }, catalogHash: digest,
      settings: { kind: "baseline", variant: {}, branchContext: "trace", secondaryCap: 4 },
      prompts: { ...provenance.integrity!.promptHashes } } };
}

test("static collection is pending, nonempty and includes source/native/check bytes without exposing checks", (t) => {
  const { root, config, provenance } = fixture(t);
  assert.equal(provenance.engine, "pending"); assert.equal(provenance.integrity!.runtime, "pending");
  assert.match(provenance.integrity!.sourceHash, /^[a-f0-9]{64}$/);
  assert.match(provenance.integrity!.bundleHash, /^[a-f0-9]{64}$/);
  assert.equal(provenance.problems.p!.turnLimit, 2);
  assert.equal(provenance.integrity!.wallClockEnforced, false);
  assert.doesNotMatch(JSON.stringify(provenance), /hidden-check-contents/);
  verifyStaticProvenance(root, config, provenance, "p");
  assert.throws(() => assertCompleteProvenance(provenance, config), /incomplete/);
});

test("freshness failure cannot be converted into a successful static snapshot", (t) => {
  const { root, config, base } = fixture(t);
  assert.throws(() => collectStaticProvenance(root, config, base, () => { throw new Error("stale artifact"); }), /stale artifact/);
  assert.throws(() => collectStaticProvenance(root, config, { ...base, commit: "unknown" }, () => {}), /commit identity/);
});

for (const path of ["packages/server/src/index.ts", "packages/server/dist/node_modules/native/prebuild.node", "experiments/problems/p/checks/check.sh"]) {
  test(`drift in ${path} rejects the pre-model gate`, (t) => {
    const { root, put, config, provenance } = fixture(t);
    put(path, "changed");
    assert.throws(() => verifyStaticProvenance(root, config, provenance, "p"), /changed/);
  });
}

test("task hash excludes references/bookkeeping but includes visible workspace and hidden checks", (t) => {
  const { root, put } = fixture(t), dir = join(root, "experiments/problems/p");
  const original = problemHash(dir);
  put("experiments/problems/p/reference/solution.patch", "answer");
  put("experiments/problems/p/.dockerignore", "generated");
  put("experiments/problems/p/.selfcheck.json", "{}");
  assert.equal(problemHash(dir), original);
  put("experiments/problems/p/checks/check.sh", "different check");
  assert.notEqual(problemHash(dir), original);
});

test("hashes distinguish path/content boundaries and reject symbolic links", (t) => {
  const { root, put } = fixture(t);
  put("one/ab", "c"); put("two/a", "bc");
  assert.notEqual(hashTree(join(root, "one")), hashTree(join(root, "two")));
  symlinkSync(join(root, "two"), join(root, "one", "escape"));
  assert.throws(() => hashTree(join(root, "one")), /symbolic link/);
});

test("runtime attestation accepts empty baseline instructions but not mutable tags, unknown engines or missing prompts", (t) => {
  const { config, provenance } = fixture(t), actual = session(provenance);
  assert.throws(() => attestJob(provenance, config, "p", "baseline", "mutable:latest", actual), /immutable/);
  actual.runtimeProvenance!.engine = "quickjs";
  assert.throws(() => attestJob(provenance, config, "p", "baseline", image, actual), /engine/);
  actual.runtimeProvenance!.engine = "isolated-vm";
  delete actual.runtimeProvenance!.prompts.executor;
  assert.throws(() => attestJob(provenance, config, "p", "baseline", image, actual), /prompt fingerprint/);
  const valid = session(provenance);
  attestJob(provenance, config, "p", "baseline", image, valid);
  assertCompleteProvenance(provenance, config);
  assert.equal(provenance.engine, "isolated-vm"); assert.equal(provenance.integrity!.nodeVersion, "v22.0.0");
  assert.equal(provenance.frameworks.baseline!.prompt, hashText(""));
  assert.throws(() => attestJob(provenance, config, "p", "baseline", `sha256:${"b".repeat(64)}`, valid), /changed/);
  valid.tools.push({ name: "write", inputSchema: {} });
  assert.throws(() => attestJob(provenance, config, "p", "baseline", image, valid), /changed/);
});

test("wrong running entrypoint, catalog or effective settings never become observations", (t) => {
  const { config, provenance } = fixture(t);
  for (const mutate of [
    (s: MCPSession) => { s.runtimeProvenance!.entryHash = digest; },
    (s: MCPSession) => { s.runtimeProvenance!.catalogHash = ""; },
    (s: MCPSession) => { s.runtimeProvenance!.settings.branchContext = "full"; },
  ]) {
    const actual = session(provenance); mutate(actual);
    assert.throws(() => attestJob(provenance, config, "p", "baseline", image, actual));
    assert.equal(provenance.integrity!.runtime, "pending");
    assert.deepEqual(Object.keys(provenance.images), []);
  }
});

test("all selected runtime cells must be observed and configuration must remain exact", (t) => {
  const { config, provenance } = fixture(t);
  config.frameworks.push("branch-only");
  attestJob(provenance, config, "p", "baseline", image, session(provenance));
  assert.throws(() => assertCompleteProvenance(provenance, config), /incomplete/);
});

test("Docker inspection records actual immutable ID and grading pins it (stub executable only)", async (t) => {
  const { root, put } = fixture(t);
  const log = join(root, "docker-arguments.jsonl");
  const bin = join(root, "bin"); mkdirSync(bin);
  const stub = join(bin, "docker");
  writeFileSync(stub, `#!${process.execPath}\nconst fs = require('node:fs'); const a = process.argv.slice(2); fs.appendFileSync(${JSON.stringify(log)}, JSON.stringify(a)+'\\n'); if(a[0]==='inspect') console.log(${JSON.stringify(image)}); else if(a[0]==='run') console.log('grading-fixture'); else if(a[0]==='cp' && a[1].endsWith(':/work')) { fs.mkdirSync(a[2], {recursive:true}); fs.writeFileSync(require('node:path').join(a[2],'main.py'),'source'); }`, { mode: 0o755 });
  const before = process.env.PATH; process.env.PATH = `${bin}:${before}`;
  try {
    assert.equal(await inspectContainerImage("container-fixture"), image);
    const jobDir = join(root, "job"); mkdirSync(jobDir);
    const result = await gradeJob({ id: "container-fixture", problem: "p", jobDir }, join(root, "experiments/problems/p"), jobDir, image);
    assert.equal(result.pass, true);
    const commands = readFileSync(log, "utf8").trim().split("\n").map((x) => JSON.parse(x));
    assert.ok(commands.some((args: string[]) => args[0] === "run" && args.includes(image)));
    assert.ok(!commands.some((args: string[]) => args.some((arg) => arg.startsWith("aiw-problem"))));
    await assert.rejects(gradeJob({ id: "fixture", problem: "p", jobDir }, root, jobDir, "mutable:latest"), /immutable/);
  } finally { process.env.PATH = before; }
});

test("a successful mocked attempt cannot finalize a pending-attestation run", async (t) => {
  const { root, config, provenance } = fixture(t);
  const { runScheduler } = await import("../src/scheduler.ts");
  const run = { format: 1 as const, id: "fixture", status: "in-progress" as const, config, provenance,
    totals: { jobs: 0, attempts: 0, costUsd: 0, pass: 0, fail: 0 }, startedAt: "fixture" };
  const reason = await runScheduler({ jobs: [{ problem: "p", framework: "baseline", rep: 0 }], config,
    runPath: root, repoRoot: root, apiKey: "fixture", baseURL: "https://example.invalid", turnLimits: {}, problemsDir: join(root, "experiments/problems"),
    runAttempt: async () => ({ outcome: "pass", reason: null, costUsd: 0, knownCostUsd: 0, durationMs: 1, eventsPath: "fixture" }) }, run);
  assert.equal(reason, "provenance-incomplete");
  assert.deepEqual(JSON.parse(readFileSync(join(root, "run.json"), "utf8")).status, { invalid: "provenance-incomplete" });
});

test("untracked source is rejected while unrelated credential storage is not scanned", (t) => {
  const { root, put, config, base, provenance } = fixture(t);
  put(".private/credentials.json", "DO-NOT-HASH-TOKEN");
  const withPrivate = collectStaticProvenance(root, config, base, () => {});
  assert.doesNotMatch(JSON.stringify(withPrivate), /DO-NOT-HASH/);
  assert.equal(withPrivate.integrity!.sourceHash, provenance.integrity!.sourceHash);
  put("packages/server/src/new.ts", "new source");
  assert.throws(() => collectStaticProvenance(root, config, base, () => {}), /untracked runtime source/);
});

test("classifier model, threshold and policy are observed settings, not request-only provenance", t => {
  const { config, provenance } = fixture(t);
  config.frameworks = ["orchestrate[rerank=classifier]"];
  config.classifier = { provider: "openrouter-decisions", model: "typesafe/jev-1.14", threshold: 0.8, policy: "noul-v1" };
  const observed = session(provenance);
  observed.runtimeProvenance!.settings = { kind: "orchestrate", variant: { rerank: "classifier" }, branchContext: "trace", secondaryCap: 4 };
  assert.throws(() => attestJob(provenance, config, "p", config.frameworks[0], image, observed), /classifier settings differ/);
  observed.runtimeProvenance!.settings.classifier = { model: config.classifier.model, threshold: 0.7, policy: "noul-v1" };
  assert.throws(() => attestJob(provenance, config, "p", config.frameworks[0], image, observed), /classifier settings differ/);
  observed.runtimeProvenance!.settings.classifier.threshold = 0.8;
  assert.doesNotThrow(() => attestJob(provenance, config, "p", config.frameworks[0], image, observed));
});
