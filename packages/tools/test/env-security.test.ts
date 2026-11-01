import test from "node:test";
import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { syncBuiltinESMExports } from "node:module";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toolEnv } from "../src/env.ts";
import { bash } from "../src/s/bash.ts";
import { runGit } from "../src/l/vcs/common.ts";
import { takeSnapshot } from "../src/snapshot.ts";
import { hasRg, filesRg, grepRg } from "../src/search.ts";
import { findVenv } from "./pyfixture.ts";
import { Sidecar } from "../src/sidecar.ts";

const synthetic = {
  PATH: "/synthetic/bin", AIW_VENV: "/synthetic/venv", KEEP: "safe",
  AIW_SECRET_NAMES: "CUSTOM_SECRET, SECOND_SECRET",
  CUSTOM_SECRET: "SENTINEL-custom", SECOND_SECRET: "SENTINEL-second",
  OPENAI_API_KEY: "SENTINEL-openai", ANTHROPIC_API_KEY: "SENTINEL-anthropic",
  OPENROUTER_API_KEY: "SENTINEL-openrouter", DEEPSEEK_API_KEY: "SENTINEL-deepseek",
  TYPESAFE_API_KEY: "SENTINEL-typesafe", CHATGPT_ACCESS_TOKEN: "SENTINEL-chatgpt",
};
function check(env: NodeJS.ProcessEnv | undefined) {
  assert.ok(env, "child must receive an explicit filtered environment");
  assert.doesNotMatch(JSON.stringify(env), /SENTINEL/);
  assert.equal(env.KEEP, "safe"); assert.equal(env.PATH, synthetic.PATH);
}

test("toolEnv strips all supported provider families and configured names without mutating input", () => {
  check(toolEnv(synthetic)); assert.equal(synthetic.DEEPSEEK_API_KEY, "SENTINEL-deepseek");
  for (const prefix of ["OPENAI_", "ANTHROPIC_", "OPENROUTER_", "DEEPSEEK_", "TYPESAFE_", "CHATGPT_"]) {
    assert.deepEqual(toolEnv({ [`${prefix}FUTURE_SECRET`]: "SENTINEL" }), {});
  }
});

test("every Node tool subprocess boundary strips synthetic host secrets, including rg probe/search", async t => {
  // Replace the environment object, never enumerate or read real host credential values.
  const original = process.env;
  process.env = { ...synthetic };
  t.after(() => { process.env = original; t.mock.restoreAll(); syncBuiltinESMExports(); });
  const root = mkdtempSync(join(tmpdir(), "aiw-env-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const seen: string[] = [];
  const stop = new Error("synthetic spawn boundary reached");
  t.mock.method(childProcess, "spawn", (command: string, _args: string[], options: any) => {
    check(options.env); seen.push(command); throw stop;
  });
  t.mock.method(childProcess, "spawnSync", (command: string, _args: string[], options: any) => {
    check(options.env); seen.push(`${command}:probe`); return { status: 0 };
  });
  syncBuiltinESMExports();
  const ctx = { root, signal: new AbortController().signal, env: { ...synthetic } };
  await assert.rejects(bash.fn({ cmd: "unused" }, ctx), stop);
  await assert.rejects(runGit(ctx, ["status"]), stop);
  await assert.rejects(takeSnapshot(root), stop);
  assert.equal(hasRg(), true);
  await assert.rejects(filesRg(root, root, "*"), stop);
  await assert.rejects(grepRg(root, "unused", ".", undefined, false), stop);
  const sidecar = new Sidecar({ root, env: { ...synthetic } });
  await assert.rejects(sidecar.call("unused", {}), stop);
  await sidecar.close();
  assert.deepEqual(seen, ["bash", "git", "tar", "rg:probe", "rg", "rg", "/synthetic/venv/bin/python"]);
});


test("real Python tool descendant cannot observe synthetic provider keys", async t => {
  const venv = findVenv();
  assert.ok(venv, "verified Python venv required for descendant coverage");
  const root = mkdtempSync(join(tmpdir(), "aiw-env-child-"));
  const sidecar = new Sidecar({ root, env: { ...synthetic, PATH: "/usr/bin:/bin", AIW_VENV: venv } });
  t.after(async () => { await sidecar.close(); rmSync(root, { recursive: true, force: true }); });
  const result = await sidecar.call("runSnippet", { code: "import os\nassert os.environ.get('KEEP') == 'safe'\nassert not any('SENTINEL' in value for value in os.environ.values())\nprint('environment-clean')" });
  assert.match(JSON.stringify(result), /environment-clean/);
  assert.doesNotMatch(JSON.stringify(result), /SENTINEL|AssertionError/);
});
