import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync, rmSync, symlinkSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
import { buildProblems, checkProblems, type SelfcheckDependencies, type ProblemCommand } from "../src/problems/index.ts";
import { assertProblemSelfcheck, collectStaticProvenance, problemHash, selfcheckInputHash } from "../src/provenance.ts";
import { assertProblemBuildContext, PROBLEM_DOCKERIGNORE } from "../src/build-context.ts";
import { buildImage } from "../src/container.ts";
import { runGradingChecks } from "../src/grade.ts";
import { DEFAULT_BRANCH_CONFIG } from "../src/config.ts";
import type { RunConfig } from "../src/types.ts";

/** Temporary synthetic inputs only. No real Docker, provider, credentials or benchmark fixtures. */
function fixture(t: TestContext, large = false) {
  const root = mkdtempSync(join(tmpdir(), "aiw-admission-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const problems = join(root, "experiments/problems"), dir = join(problems, "fixture");
  const put = (path: string, data: string) => { const full = join(dir, path); mkdirSync(join(full, ".."), { recursive: true }); writeFileSync(full, data); };
  put("task.json", JSON.stringify({ size: large ? "large" : "small", set: "dev", turnLimit: 2, ...(large ? { codebase: "base" } : {}) }));
  put(".dockerignore", PROBLEM_DOCKERIGNORE);
  put("task.md", "Repair the observed behavior."); put("Dockerfile", "FROM fixture-only\nCOPY workspace/ /work/\n");
  put("workspace/main.py", "broken"); put("checks/check.sh", "synthetic checks");
  put("reference/solution.patch", "synthetic patch"); put("reference/notes.md", "---\nfixWords: [answer]\n---\n");
  if (large) put("../_codebases/base/main.py", "clean");
  const stampPath = join(dir, ".selfcheck.json");
  // Only test fixtures author synthetic stamps. Production stamps require the actual checker.
  const stamp = () => ({ version: 1, pass: true, taskHash: problemHash(dir), inputHash: selfcheckInputHash(dir), checkedAt: "2026-11-02T00:00:00.000Z", checkDurationMs: 1 });
  const writeStamp = (data: unknown = stamp()) => writeFileSync(stampPath, JSON.stringify(data));
  return { root, problems, dir, put, stampPath, stamp, writeStamp };
}

/** Fake only external process/grading boundaries; exercise the production self-check workflow. */
function fakeChecks(outcomes = [false, true, true, true, true, true, true]) {
  const calls: string[] = [], outputs: string[] = [];
  let grade = 0;
  const deps: SelfcheckDependencies = {
    run: async (command, args) => { calls.push(`${command} ${args.join(" ")}`); return { stdout: "", stderr: "" }; },
    buildImage: async () => { calls.push("image"); return `sha256:${"a".repeat(64)}`; },
    startContainer: async (problem, jobDir) => { calls.push("start"); return { id: "fake", problem, jobDir }; },
    removeContainer: async () => { calls.push("remove"); },
    gradeJob: async (_container, _problemDir, output) => {
      calls.push("grade"); outputs.push(output); writeFileSync(join(output, "check.log"), "synthetic check output");
      writeFileSync(join(output, "diff.patch"), "synthetic diff");
      return { pass: outcomes[grade++] ?? false, reason: "checks", checksCompleted: true };
    },
  };
  return { deps, calls, outputs };
}

for (const error of [new Error("tests failed"), new Error("No such image"), Object.assign(new Error("docker unavailable"), { code: "ENOENT" })]) {
  test(`clean-base ${error.message} blocks rebuild and invalidates prior success`, async t => {
    const f = fixture(t, true); f.writeStamp();
    const calls: string[][] = [];
    const run: ProblemCommand = async (command, args) => { calls.push([command, ...args]); throw error; };
    await assert.rejects(buildProblems(["fixture"], f.problems, run), /clean codebase tests failed/);
    assert.equal(readFileSync(join(f.dir, "workspace/main.py"), "utf8"), "broken");
    assert.equal(existsSync(f.stampPath), false);
    assert.equal(calls.length, 1); assert.equal(calls[0][0], "docker");
    assert.ok(calls[0].includes("none")); assert.ok(calls[0].some(arg => arg.endsWith(":/work:ro")));
  });
}

test("any missing selected workspace blocks all check work instead of skipping a fixture", async t => {
  const f = fixture(t), fake = fakeChecks(); f.writeStamp();
  await assert.rejects(checkProblems(["fixture", "missing"], f.problems, fake.deps), /fixture directory.*missing/);
  assert.deepEqual(fake.calls, []);
  rmSync(join(f.dir, "workspace"), { recursive: true });
  await assert.rejects(checkProblems(["fixture"], f.problems, fake.deps), /fixture.*required workspace/);
  assert.equal(existsSync(f.stampPath), false);
  assert.deepEqual(fake.calls, []);
});

test("successful checker and consumer use the same canonical identity and isolate outputs", async t => {
  const f = fixture(t), fake = fakeChecks();
  await checkProblems(["fixture"], f.problems, fake.deps);
  assert.equal(assertProblemSelfcheck(f.dir), problemHash(f.dir));
  const stamp = JSON.parse(readFileSync(f.stampPath, "utf8"));
  assert.equal(stamp.version, 1); assert.equal(stamp.inputHash, selfcheckInputHash(f.dir));
  assert.equal(fake.calls.filter(x => x === "grade").length, 7); // empty plus initial solved grade and five stability repetitions
  assert.equal(fake.calls.filter(x => x === "remove").length, 7);
  assert.equal(existsSync(join(f.dir, "check.log")), false);
  assert.equal(existsSync(join(f.dir, "diff.patch")), false);
  assert.ok(fake.outputs.every(dir => !existsSync(dir)));
});

for (const outcomes of [[true], [false, false], [false, true, true, false]]) {
  test(`failed grading ${JSON.stringify(outcomes)} removes old success and stops at failure`, async t => {
    const f = fixture(t), fake = fakeChecks(outcomes); f.writeStamp();
    await assert.rejects(checkProblems(["fixture"], f.problems, fake.deps), /failed for: fixture/);
    assert.equal(existsSync(f.stampPath), false);
    assert.equal(fake.calls.filter(x => x === "grade").length, outcomes.length);
    assert.equal(fake.calls.filter(x => x === "remove").length, outcomes.length);
    assert.ok(fake.outputs.every(dir => !existsSync(dir)));
  });
}

test("missing fix-word metadata and leaked answer cannot produce success", async t => {
  const f = fixture(t);
  f.put("reference/notes.md", "no declaration");
  await assert.rejects(checkProblems(["fixture"], f.problems, fakeChecks().deps), /failed for/);
  assert.equal(existsSync(f.stampPath), false);
  f.put("reference/notes.md", "---\nfixWords: [answer]\n---\n"); f.put("task.md", "The ANSWER is here");
  await assert.rejects(checkProblems(["fixture"], f.problems, fakeChecks().deps), /failed for/);
  assert.equal(existsSync(f.stampPath), false);
});

test("input mutation during checks never becomes a fresh stamp for unchecked bytes", async t => {
  const f = fixture(t), fake = fakeChecks();
  const grade = fake.deps.gradeJob!;
  fake.deps.gradeJob = async (...args) => { const result = await grade(...args); f.put("task.md", "changed during check"); return result; };
  await assert.rejects(checkProblems(["fixture"], f.problems, fake.deps), /failed for/);
  assert.equal(existsSync(f.stampPath), false);
});

for (const path of ["workspace/main.py", "checks/check.sh", "task.md", "Dockerfile", "reference/solution.patch", "reference/notes.md", "../_codebases/base/main.py"]) {
  test(`changed ${path} invalidates admission`, t => {
    const f = fixture(t, true); f.writeStamp(); f.put(path, "changed");
    assert.throws(() => assertProblemSelfcheck(f.dir), /stale inputs/);
  });
}

test("generated metadata is excluded without conflating task identity and validation inputs", t => {
  const f = fixture(t); f.writeStamp();
  const taskHash = problemHash(f.dir);
  f.put(".dockerignore", "*\n!workspace/\n");
  assert.equal(assertProblemSelfcheck(f.dir), taskHash);
  f.put("reference/solution.patch", "new reference");
  assert.equal(problemHash(f.dir), taskHash);
  assert.throws(() => assertProblemSelfcheck(f.dir), /stale inputs/);
});

for (const malformed of [null, [], { version: undefined }, { version: 0 }, { pass: false }, { pass: "true" }, { taskHash: "a" }, { inputHash: "a" }, { checkedAt: "no-date" }, { checkDurationMs: -1 }]) {
  test(`malformed/failed/unrecognized stamp ${JSON.stringify(malformed)} blocks before expensive preflight`, t => {
    const f = fixture(t);
    f.writeStamp(malformed && !Array.isArray(malformed) ? { ...f.stamp(), ...malformed } : malformed);
    let expensive = 0;
    const config = { problems: ["fixture"], branch: DEFAULT_BRANCH_CONFIG } as RunConfig;
    assert.throws(() => collectStaticProvenance(f.root, config,
      { commit: "a".repeat(40), dirty: false, runnerVersion: "fixture", engine: "pending", basePrompt: "a".repeat(64) },
      () => { expensive++; throw new Error("must not reach bundle/provider work"); }), /self-check admission/);
    assert.equal(expensive, 0);
  });
}

test("missing, invalid JSON and symlink stamps fail closed", t => {
  const f = fixture(t);
  assert.throws(() => assertProblemSelfcheck(f.dir), /missing or malformed/);
  writeFileSync(f.stampPath, "{"); assert.throws(() => assertProblemSelfcheck(f.dir), /missing or malformed/);
  rmSync(f.stampPath); f.put("stamp.json", JSON.stringify(f.stamp()));
  symlinkSync(join(f.dir, "stamp.json"), f.stampPath);
  assert.throws(() => assertProblemSelfcheck(f.dir), /missing or malformed/);
});

test("exactly 30 seconds is not a passing sub-30-second self-check", async t => {
  const f = fixture(t), fake = fakeChecks();
  const times = [0, 0, 30_000];
  t.mock.method(Date, "now", () => times.shift() ?? 30_000);
  await assert.rejects(checkProblems(["fixture"], f.problems, fake.deps), /failed for/);
  assert.equal(existsSync(f.stampPath), false);
  assert.equal(fake.calls.filter(x => x === "grade").length, 2);
});

test("a later selected invalid stamp blocks evaluation before any expensive work", t => {
  const f = fixture(t); f.writeStamp();
  let expensive = 0;
  const config = { problems: ["fixture", "missing"], branch: DEFAULT_BRANCH_CONFIG } as RunConfig;
  assert.throws(() => collectStaticProvenance(f.root, config,
    { commit: "a".repeat(40), dirty: false, runnerVersion: "fixture", engine: "pending", basePrompt: "a".repeat(64) },
    () => { expensive++; }), /self-check admission|fixture directory/);
  assert.equal(expensive, 0);
});

test("an empty-diff patch failure is not evidence that the broken fixture fails checks", async t => {
  const f = fixture(t), fake = fakeChecks();
  fake.deps.gradeJob = async () => ({ pass: false, reason: "patch-failed" });
  await assert.rejects(checkProblems(["fixture"], f.problems, fake.deps), /failed for/);
  assert.equal(existsSync(f.stampPath), false);
});

test("missing clean codebase blocks before Docker can create an empty source", async t => {
  const f = fixture(t, true); rmSync(join(f.problems, "_codebases/base"), { recursive: true });
  let calls = 0;
  await assert.rejects(buildProblems(["fixture"], f.problems, async () => { calls++; return { stdout: "", stderr: "" }; }));
  assert.equal(calls, 0);
  assert.equal(readFileSync(join(f.dir, "workspace/main.py"), "utf8"), "broken");
});

for (const phase of ["validation", "materialization"]) {
  test(`clean-base mutation during ${phase} cannot be stamped`, async t => {
    const f = fixture(t, true);
    const run: ProblemCommand = async (command, args) => {
      if (command === "docker" && phase === "validation") f.put("../_codebases/base/main.py", "changed during validation");
      if (command === "cp") { cpSync(join(f.problems, "_codebases/base"), args[2], { recursive: true }); f.put("../_codebases/base/main.py", "changed during copy"); }
      return { stdout: "", stderr: "" };
    };
    await assert.rejects(buildProblems(["fixture"], f.problems, run), /clean codebase changed/);
    assert.equal(existsSync(f.stampPath), false);
  });
}

test("valid clean-base build copies tested bytes and requires nonzero discovered tests", async t => {
  const f = fixture(t, true);
  let command = "";
  const run: ProblemCommand = async (name, args) => {
    if (name === "docker") command = args.at(-1)!;
    if (name === "cp") cpSync(join(f.problems, "_codebases/base"), args[2], { recursive: true });
    return { stdout: "", stderr: "" };
  };
  await buildProblems(["fixture"], f.problems, run);
  assert.match(command, /countTestCases/); assert.match(command, /sys\.exit\(2\) if count == 0/);
  assert.equal(readFileSync(join(f.dir, "workspace/main.py"), "utf8"), "clean");
});

/** Execute only the authored Python check from the fake Docker boundary, never Docker itself. */
for (const [label, body, passes] of [
  ["positive assertions", "    def test_ok(self): self.assertEqual(2 + 2, 4)\n", true],
  ["empty suite", "", false],
  ["all skipped", "    @unittest.skip('not available')\n    def test_skip(self): pass\n", false],
  ["partially skipped", "    def test_ok(self): self.assertTrue(True)\n    @unittest.skip('not available')\n    def test_skip(self): pass\n", false],
  ["expected failure", "    @unittest.expectedFailure\n    def test_expected(self): self.fail('failure')\n", false],
  ["unexpected success", "    @unittest.expectedFailure\n    def test_unexpected(self): pass\n", false],
  ["failed assertion", "    def test_bad(self): self.fail('failure')\n", false],
  ["error", "    def test_error(self): raise ValueError('error')\n", false],
] as const) {
  test(`clean-base actual Python gate ${passes ? "accepts" : "rejects"} ${label} before overlay`, async t => {
    const f = fixture(t, true); f.writeStamp();
    f.put("../_codebases/base/test_clean.py", "import unittest\n" +
      (body ? "class CleanTests(unittest.TestCase):\n" + body : ""));
    const commands: string[] = [];
    const run: ProblemCommand = async (command, args) => {
      commands.push(command);
      if (command === "docker") {
        const python = process.env.AIW_VENV ? join(process.env.AIW_VENV, "bin/python") : "python3";
        // This is a local synthetic codebase, not a repository fixture or a container run.
        const stdout = execFileSync(python, ["-B", "-c", args.at(-1)!], {
          cwd: join(f.problems, "_codebases/base"), encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], timeout: 10_000,
        });
        return { stdout, stderr: "" };
      }
      if (command === "cp") cpSync(join(f.problems, "_codebases/base"), args[2], { recursive: true });
      return { stdout: "", stderr: "" };
    };
    if (passes) {
      await buildProblems(["fixture"], f.problems, run);
      assert.equal(readFileSync(join(f.dir, "workspace/main.py"), "utf8"), "clean");
      assert.deepEqual(commands, ["docker", "cp", "find"]);
    } else {
      await assert.rejects(buildProblems(["fixture"], f.problems, run), /clean codebase tests failed/);
      assert.equal(readFileSync(join(f.dir, "workspace/main.py"), "utf8"), "broken");
      assert.deepEqual(commands, ["docker"], "copy and overlay must not follow incomplete validation");
    }
    assert.equal(existsSync(f.stampPath), false, "a rebuild never preserves an earlier success stamp");
  });
}

for (const metadata of ["# fixWords: []\nfixWords: [answer]", "notfixWords: []", "fixWords: []\nfixWords: [answer]", "fixWords: ['unterminated]", "fixWords: [answer,]", "fixWords: [\"\"]"]) {
  test(`fix-word lint cannot be bypassed with ${JSON.stringify(metadata)}`, async t => {
    const f = fixture(t); f.put("reference/notes.md", `---\n${metadata}\n---\n`); f.put("task.md", "The answer is here.");
    await assert.rejects(checkProblems(["fixture"], f.problems, fakeChecks().deps), /failed for/);
    assert.equal(existsSync(f.stampPath), false);
  });
}

test("bounded stamp reader rejects oversize, duplicates, unknown fields and invalid UTF8 without input leakage", t => {
  const f = fixture(t), sentinel = "UNTRUSTED_STAMP_SECRET";
  const valid = JSON.stringify(f.stamp());
  for (const raw of [" ".repeat(4097), `${valid.slice(0, -1)},"pass":true}`, `${valid.slice(0, -1)},"pa\\u0073s":true}`,
    JSON.stringify({ ...f.stamp(), unknown: sentinel }), `{"${sentinel}":`, Buffer.from([0xff])]) {
    writeFileSync(f.stampPath, raw);
    assert.throws(() => assertProblemSelfcheck(f.dir), error => {
      assert.ok(error instanceof Error); assert.match(error.message, /self-check admission/);
      assert.ok(!error.message.includes(sentinel)); return true;
    });
  }
});

test("FIFO stamps are rejected without blocking on a writer", { timeout: 2000 }, t => {
  const f = fixture(t);
  execFileSync("mkfifo", [f.stampPath]);
  assert.throws(() => assertProblemSelfcheck(f.dir), /missing or malformed/);
});

// The real grader's Docker boundary must prove that a check script exited, not merely that exec failed.
for (const exitCode of [0, 1, 125]) {
  test(`grader records completed check exit ${exitCode} at fake Docker boundary`, async () => {
    const result = await runGradingChecks("fake", async (_command, args) => {
      const marker = args.at(-1)!.match(/AIW_CHECK_EXIT_[a-f0-9-]+/)![0];
      const output = { stdout: "check stdout", stderr: `check stderr\n${marker}:${exitCode}\n` };
      if (exitCode) throw Object.assign(new Error("fake check failure"), { code: exitCode, ...output });
      return output;
    });
    assert.deepEqual(result, { output: "check stdoutcheck stderr", exitCode, completed: true });
  });
}
for (const code of ["ENOENT", 1, 125]) {
  test(`grader rejects Docker failure ${code} without check completion`, async () => {
    await assert.rejects(runGradingChecks("fake", async () => { throw Object.assign(new Error("fake docker failure"), { code, stderr: "daemon unavailable" }); }), /completed exit status/);
  });
}

test("grader rejects missing or inconsistent completion even when Docker exits zero", async () => {
  await assert.rejects(runGradingChecks("fake", async () => ({ stdout: "", stderr: "" })), /completed exit status/);
  await assert.rejects(runGradingChecks("fake", async (_command, args) => {
    const marker = args.at(-1)!.match(/AIW_CHECK_EXIT_[a-f0-9-]+/)![0];
    return { stdout: "", stderr: `\n${marker}:1\n` };
  }), /completed exit status/);
});

test("grading timeout remains a failed outcome but cannot validate a broken baseline", async t => {
  const result = await runGradingChecks("fake", async () => { throw Object.assign(new Error("timeout"), { code: 124, stdout: "partial", stderr: "" }); });
  assert.deepEqual(result, { output: "partial", exitCode: 124, completed: false });
  const f = fixture(t), fake = fakeChecks();
  fake.deps.gradeJob = async () => ({ pass: false, reason: "checks", checksCompleted: result.completed });
  await assert.rejects(checkProblems(["fixture"], f.problems, fake.deps), /failed for/);
  assert.equal(existsSync(f.stampPath), false);
});

for (const id of ["../outside", "fixture/..", "", ".", "..", "/tmp/outside", "bad\nid", "bad\\id"]) {
  test(`unsafe selected identifier ${JSON.stringify(id)} rejects before any mutation or process`, async t => {
    const f = fixture(t), fake = fakeChecks(); f.writeStamp();
    f.put("../outside/sentinel", "untouched");
    const before = readFileSync(f.stampPath, "utf8");
    await assert.rejects(buildProblems(["fixture", id], f.problems, fake.deps.run), /unsafe fixture identifier/);
    await assert.rejects(checkProblems(["fixture", id], f.problems, fake.deps), /unsafe fixture identifier/);
    assert.deepEqual(fake.calls, []);
    assert.equal(readFileSync(f.stampPath, "utf8"), before);
    assert.equal(readFileSync(join(f.problems, "outside/sentinel"), "utf8"), "untouched");
    assert.equal(readFileSync(join(f.dir, "workspace/main.py"), "utf8"), "broken");
  });
}

for (const codebase of ["../../outside", "/tmp/outside", ".", "", "base/../other", "bad\nbase"]) {
  test(`unsafe codebase ${JSON.stringify(codebase)} rejects before hash, mutation or Docker`, async t => {
    const f = fixture(t, true), fake = fakeChecks(); f.writeStamp();
    const before = readFileSync(f.stampPath, "utf8");
    f.put("task.json", JSON.stringify({ size: "large", codebase, turnLimit: 2 }));
    f.put("../../outside/sentinel", "untouched");
    assert.throws(() => selfcheckInputHash(f.dir), /unsafe fixture identifier/);
    await assert.rejects(buildProblems(["fixture"], f.problems, fake.deps.run), /unsafe fixture identifier/);
    await assert.rejects(checkProblems(["fixture"], f.problems, fake.deps), /unsafe fixture identifier/);
    assert.deepEqual(fake.calls, []);
    assert.equal(readFileSync(f.stampPath, "utf8"), before);
    assert.equal(readFileSync(join(f.root, "experiments/outside/sentinel"), "utf8"), "untouched");
    assert.equal(readFileSync(join(f.dir, "workspace/main.py"), "utf8"), "broken");
  });
}

test("symlinked problem directory and symlinked problems root cannot invalidate outside stamps", async t => {
  const f = fixture(t), fake = fakeChecks(); f.writeStamp();
  const before = readFileSync(f.stampPath, "utf8");
  symlinkSync(f.dir, join(f.problems, "linked"));
  symlinkSync(f.problems, join(f.root, "linked-problems"));
  for (const [root, id] of [[f.problems, "linked"], [join(f.root, "linked-problems"), "fixture"]]) {
    await assert.rejects(buildProblems([id], root, fake.deps.run), /symbolic links|fixture directory/);
    await assert.rejects(checkProblems([id], root, fake.deps), /symbolic links|fixture directory/);
    assert.equal(readFileSync(f.stampPath, "utf8"), before);
  }
  assert.deepEqual(fake.calls, []);
});

test("symlinked clean-codebase ancestor blocks hashing and all command mutations", async t => {
  const f = fixture(t, true), fake = fakeChecks(); f.writeStamp();
  const before = readFileSync(f.stampPath, "utf8");
  const external = join(f.root, "external-base");
  cpSync(join(f.problems, "_codebases"), external, { recursive: true });
  rmSync(join(f.problems, "_codebases"), { recursive: true });
  symlinkSync(external, join(f.problems, "_codebases"));
  assert.throws(() => selfcheckInputHash(f.dir), /fixture directory/);
  await assert.rejects(buildProblems(["fixture"], f.problems, fake.deps.run), /fixture directory/);
  await assert.rejects(checkProblems(["fixture"], f.problems, fake.deps), /fixture directory/);
  assert.deepEqual(fake.calls, []);
  assert.equal(readFileSync(f.stampPath, "utf8"), before);
  assert.equal(readFileSync(join(external, "base/main.py"), "utf8"), "clean");
});

test("linked task metadata is rejected before reading it or changing the fixture", async t => {
  const f = fixture(t), fake = fakeChecks(); f.writeStamp();
  const before = readFileSync(f.stampPath, "utf8");
  const outside = join(f.root, "outside-task.json");
  writeFileSync(outside, "THIS IS NOT JSON AND MUST NOT BE READ");
  rmSync(join(f.dir, "task.json")); symlinkSync(outside, join(f.dir, "task.json"));
  await assert.rejects(buildProblems(["fixture"], f.problems, fake.deps.run), /task.json must be a regular file/);
  await assert.rejects(checkProblems(["fixture"], f.problems, fake.deps), /task.json must be a regular file/);
  assert.deepEqual(fake.calls, []);
  assert.equal(readFileSync(f.stampPath, "utf8"), before);
});

test("empty discovery and symbolic-link problem entries cannot become successful checks", async t => {
  const f = fixture(t), fake = fakeChecks();
  symlinkSync(f.dir, join(f.problems, "linked"));
  await assert.rejects(checkProblems([], f.problems, fake.deps), /symbolic links/);
  rmSync(join(f.problems, "linked")); rmSync(f.dir, { recursive: true });
  await assert.rejects(checkProblems([], f.problems, fake.deps), /no problem fixtures/);
  await assert.rejects(buildProblems([], f.problems, fake.deps.run), /no problem fixtures/);
  assert.deepEqual(fake.calls, []);
});

for (const name of [".dockerignore", ".selfcheck.json", "workspace"]) {
  test(`linked generated path ${name} cannot redirect writes or partial invalidation`, async t => {
    const f = fixture(t), fake = fakeChecks(); f.writeStamp();
    const outside = join(f.root, "outside-sentinel"); writeFileSync(outside, "untouched");
    rmSync(join(f.dir, name), { recursive: true, force: true }); symlinkSync(outside, join(f.dir, name));
    await assert.rejects(buildProblems(["fixture"], f.problems, fake.deps.run), /symbolic link/);
    await assert.rejects(checkProblems(["fixture"], f.problems, fake.deps), /symbolic link/);
    assert.equal(readFileSync(outside, "utf8"), "untouched");
    assert.deepEqual(fake.calls, []);
  });
}

for (const policy of [null, "", "*\n!reference/\n", "*\n!workspace/\n!checks/\n", "*\n!workspace/\n!reference/\n", "#".repeat(4097)]) {
  test(`changed generated ignore ${JSON.stringify(policy)?.slice(0, 70)} blocks image and eval before external work`, async t => {
    const f = fixture(t); f.writeStamp();
    const hash = problemHash(f.dir);
    if (policy === null) rmSync(join(f.dir, ".dockerignore")); else f.put(".dockerignore", policy);
    assert.equal(problemHash(f.dir), hash); // It is intentionally not part of canonical task identity.
    let docker = 0, expensive = 0;
    await assert.rejects(buildImage(f.dir, "fixture", async () => { docker++; return { stdout: "" }; }), /build-context admission/);
    assert.throws(() => assertProblemSelfcheck(f.dir), /build-context admission/);
    assert.throws(() => collectStaticProvenance(f.root, { problems: ["fixture"], branch: DEFAULT_BRANCH_CONFIG } as RunConfig,
      { commit: "a".repeat(40), dirty: false, runnerVersion: "fixture", engine: "pending", basePrompt: "a".repeat(64) },
      () => { expensive++; }), /build-context admission/);
    assert.equal(docker, 0); assert.equal(expensive, 0);
  });
}

for (const kind of ["symlink", "fifo", "directory"]) {
  test(`generated ignore ${kind} is rejected without following, blocking or invoking Docker`, { timeout: 2000 }, async t => {
    const f = fixture(t), path = join(f.dir, ".dockerignore"); rmSync(path);
    const outside = join(f.root, "outside-policy"); writeFileSync(outside, PROBLEM_DOCKERIGNORE);
    if (kind === "symlink") symlinkSync(outside, path);
    else if (kind === "fifo") execFileSync("mkfifo", [path]);
    else mkdirSync(path);
    let calls = 0;
    await assert.rejects(buildImage(f.dir, "fixture", async () => { calls++; return { stdout: "" }; }), /build-context admission/);
    assert.equal(calls, 0); assert.equal(readFileSync(outside, "utf8"), PROBLEM_DOCKERIGNORE);
  });
}

test("Dockerfile-specific override cannot bypass the generated context allowlist", async t => {
  const f = fixture(t); f.writeStamp(); f.put("Dockerfile.dockerignore", "!reference/\n!checks/\n");
  let calls = 0;
  assert.throws(() => assertProblemBuildContext(f.dir), /build-context admission/);
  await assert.rejects(buildImage(f.dir, "fixture", async () => { calls++; return { stdout: "" }; }), /build-context admission/);
  assert.equal(calls, 0);
});

test("generator and image admission share exact workspace-only policy excluding hidden sentinel trees", async t => {
  const f = fixture(t), fake = fakeChecks();
  f.put("reference/secret.txt", "REFERENCE_SENTINEL"); f.put("checks/secret.txt", "CHECKS_SENTINEL");
  rmSync(join(f.dir, ".dockerignore"));
  await buildProblems(["fixture"], f.problems, fake.deps.run);
  assert.equal(readFileSync(join(f.dir, ".dockerignore"), "utf8"), PROBLEM_DOCKERIGNORE);
  assert.deepEqual(PROBLEM_DOCKERIGNORE.trim().split("\n"), ["*", "!workspace/"]);
  assert.doesNotThrow(() => assertProblemBuildContext(f.dir));
  const calls: string[][] = [];
  const image = await buildImage(f.dir, "fixture", async (_command, args) => {
    calls.push(args);
    return { stdout: args[0] === "image" ? JSON.stringify([{ Id: `sha256:${"a".repeat(64)}`, RepoDigests: [] }]) : "" };
  });
  assert.equal(image, `sha256:${"a".repeat(64)}`); assert.equal(calls.length, 2);
  assert.doesNotMatch(JSON.stringify(calls), /REFERENCE_SENTINEL|CHECKS_SENTINEL/);
  // Contract validation only: this test does not claim a real Docker context was constructed.
});

test("the fifth stability repetition after initial solved success is mandatory", async t => {
  const f = fixture(t), fake = fakeChecks([false, true, true, true, true, true, false]);
  await assert.rejects(checkProblems(["fixture"], f.problems, fake.deps), /failed for/);
  assert.equal(fake.calls.filter(call => call === "grade").length, 7);
  assert.equal(existsSync(f.stampPath), false);
});
