import test from "node:test";
import assert from "node:assert/strict";
import { cpSync, mkdtempSync, mkdirSync, rmSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

/** Real packaged MCP fixture, relocated away from workspace node_modules and external source resources. */
test("relocated bundle has native dependency closure and complete tierL runtime resources", { timeout: 60_000 }, async () => {
  const temporary = mkdtempSync(join(tmpdir(), "aiw-packaged-readiness-"));
  const bundle = join(temporary, "bundle");
  const root = join(temporary, "work");
  mkdirSync(root);
  const original = "def hello() -> int:\n    return 42\n";
  writeFileSync(join(root, "fixture.py"), original);
  cpSync(fileURLToPath(new URL("../dist", import.meta.url)), bundle, { recursive: true });
  const venv = [process.env.AIW_VENV, fileURLToPath(new URL("../../tools/.venv", import.meta.url)), "/opt/aiw/venv"]
    .filter((path): path is string => !!path).map(path => resolve(path)).find(path => existsSync(join(path, "bin/python")));
  assert.ok(venv, "Packaged tierL preflight requires a verified Python venv; set AIW_VENV");
  const client = new Client({ name: "packaged-readiness", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["--no-node-snapshot", join(bundle, "aiw-server.mjs"), "--engine", "isolated-vm", "--framework", "baseline", "--tier", "L", "--root", root],
    cwd: temporary, stderr: "pipe", env: { AIW_VENV: venv, NODE_PATH: "", PATH: process.env.PATH ?? "", XDG_CACHE_HOME: join(temporary, "cache") },
  });
  let stderr = "";
  transport.stderr?.on("data", chunk => { stderr += String(chunk); });
  /** Fail at the first broken required capability; no tools or assertions are silently omitted. */
  async function call(name: string, args: Record<string, unknown>) {
    const result = await client.callTool({ name, arguments: args });
    assert.notEqual(result.isError, true, `${name}: ${JSON.stringify(result)}`);
    return JSON.stringify(result);
  }
  try {
    await client.connect(transport);
    assert.match(stderr, /engine=isolated-vm/);
    assert.match(await call("outline", { path: "fixture.py" }), /hello/);
    await call("check", { path: "fixture.py", kinds: ["types", "lint"] });
    assert.match(await call("issues", { op: "search", query: "login" }), /issues/);
    writeFileSync(join(root, "fixture.py"), original.replace("42", "43"));
    assert.match(await call("diff", { path: "fixture.py" }), /modified/);
    await call("restore", { path: "fixture.py" });
    assert.equal(readFileSync(join(root, "fixture.py"), "utf8"), original);
    await client.close();
    const branchClient = new Client({ name: "packaged-native-branch", version: "1" });
    const branchTransport = new StdioClientTransport({ command: process.execPath,
      args: ["--no-node-snapshot", join(bundle, "aiw-server.mjs"), "--engine", "isolated-vm", "--framework", "branch-only", "--root", root],
      cwd: temporary, stderr: "pipe", env: { NODE_PATH: "" },
    });
    try {
      await branchClient.connect(branchTransport);
      const result = await branchClient.callTool({ name: "branch", arguments: { code: "async () => 42" } });
      assert.notEqual(result.isError, true, JSON.stringify(result));
      assert.match(JSON.stringify(result), /return 42/);
    } finally { await branchClient.close(); }
  } finally {
    await client.close();
    rmSync(temporary, { recursive: true, force: true });
  }
});
