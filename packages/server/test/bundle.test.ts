import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";

const build = fileURLToPath(new URL("../build.mjs", import.meta.url));
const bundle = fileURLToPath(new URL("../dist/aiw-server.mjs", import.meta.url));

test("packaged server bundle and prompts match the exact current source", () => {
  const result = spawnSync(process.execPath, [build, "--check"], { encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

test("packaged runtime rejects unsupported framework variants before MCP startup", () => {
  const result = spawnSync(process.execPath, [bundle, "--framework", "branch-only:unknown=true"], {
    encoding: "utf8", timeout: 10_000,
  });
  assert.equal(result.error, undefined);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /variant|Unsupported|Unknown/i);
});

for (const engine of ["typo", "isolated-vm"]) {
  test(`packaged CLI refuses ${engine} without silently starting QuickJS`, () => {
    const result = spawnSync(process.execPath, [bundle, "--engine", engine], {
      encoding: "utf8", timeout: 10_000,
      // Force the deterministic native-selection prerequisite failure even on native-enabled CI.
      env: { ...process.env, NODE_OPTIONS: "" },
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, engine === "typo" ? /Unsupported engine/ : /engine "isolated-vm" is unavailable.*no-node-snapshot/);
    assert.equal(result.stdout, "");
    assert.doesNotMatch(result.stderr, /engine=quickjs/);
  });
}

test("packaged runtime executes a branch with the explicitly selected QuickJS engine", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const client = new Client({ name: "packaged-runtime-fixture", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [bundle, "--engine", "quickjs", "--framework", "branch-only"], stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: "branch", arguments: {
      code: 'async (tools, state) => { state.engineFixture = 42; return state.engineFixture; }',
    } });
    assert.notEqual(result.isError, true, JSON.stringify(result));
    assert.match(JSON.stringify(result), /42/);
    assert.match(stderr, /aiw-server: engine=quickjs/);
  } finally { await client.close(); }
});

test("server forwards its explicit runtime into branch execution instead of using the default", async () => {
  const { Client } = await import("@modelcontextprotocol/sdk/client/index.js");
  const { StdioClientTransport } = await import("@modelcontextprotocol/sdk/client/stdio.js");
  const serverURL = new URL("../src/server.ts", import.meta.url).href;
  const code = `import { startServer } from ${JSON.stringify(serverURL)};
    await startServer({kind:"branch-only",host:{async tools(){return []},async call(){throw Error("unexpected host call")},async close(){}},
      runtime:{async create(){throw Error("explicit-runtime-fixture")}}});`;
  const client = new Client({ name: "runtime-injection-fixture", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["--import", "tsx", "--input-type=module", "--eval", code], stderr: "pipe" });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: "branch", arguments: { code: "async () => 42" } });
    assert.equal(result.isError, true);
    assert.match(JSON.stringify(result), /explicit-runtime-fixture/);
  } finally { await client.close(); }
});

// Migration and runtime snapshots share the base hygiene file byte-for-byte. Keep
// stronger packaged-resource checks enforced by the authoritative server suite.
const repositoryRoot = fileURLToPath(new URL("../../../", import.meta.url));
const runtimeHygiene = fileURLToPath(new URL("../../../scripts/check-runtime-gitignore.sh", import.meta.url));

test("runtime hygiene enforces baseline and packaged resource trackability", () => {
  const result = spawnSync("sh", [runtimeHygiene], { cwd: repositoryRoot, encoding: "utf8" });
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
});

for (const asset of [
  "packages/server/dist/python/aiw_sidecar/__init__.py",
  "packages/server/dist/fixtures/external/ciStatus.json",
  "packages/tools/python/requirements.txt",
]) {
  test(`runtime hygiene rejects an index missing ${asset} without touching the real index`, () => {
    const temporary = mkdtempSync(join(tmpdir(), "aiw-hygiene-index-"));
    const env = { ...process.env, GIT_INDEX_FILE: join(temporary, "index") };
    try {
      const read = spawnSync("git", ["read-tree", "HEAD"], { cwd: repositoryRoot, env, encoding: "utf8" });
      assert.equal(read.status, 0, read.stderr);
      const remove = spawnSync("git", ["update-index", "--force-remove", "--", asset], { cwd: repositoryRoot, env, encoding: "utf8" });
      assert.equal(remove.status, 0, remove.stderr);
      const result = spawnSync("sh", [runtimeHygiene], { cwd: repositoryRoot, env, encoding: "utf8" });
      assert.notEqual(result.status, 0, "Missing tracked asset must fail");
      assert.match(result.stderr, new RegExp(asset.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
      const actual = spawnSync("git", ["ls-files", "--error-unmatch", "--", asset], { cwd: repositoryRoot, encoding: "utf8" });
      assert.equal(actual.status, 0, "Real Git index must remain unchanged");
    } finally { rmSync(temporary, { recursive: true, force: true }); }
  });
}
