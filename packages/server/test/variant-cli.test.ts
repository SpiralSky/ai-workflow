import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Invalid treatment must fail before a host/session can start. No model endpoint is contacted.
for (const entry of ["source", "bundle"] as const) {
for (const variant of ["orchestrate[rerank=typo]", "orchestrate[secondary=2x]", "orchestrate[executor=calls]"]) {
  test(`${entry} server CLI fails closed for ${variant}`, () => {
    const args = entry === "source"
      ? ["--import", "tsx", fileURLToPath(new URL("../src/cli.ts", import.meta.url))]
      : [fileURLToPath(new URL("../dist/aiw-server.mjs", import.meta.url))];
    const result = spawnSync(process.execPath, [...args, "--framework", variant], {
      encoding: "utf8", timeout: 10000,
    });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported variant|positive safe integer|not implemented/);
  });
}
}
