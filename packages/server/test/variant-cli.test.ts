import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

// Invalid treatment must fail before a host/session can start. No model endpoint is contacted.
for (const variant of ["orchestrate[rerank=typo]", "orchestrate[secondary=2x]", "orchestrate[executor=calls]"]) {
  test(`server CLI fails closed for ${variant}`, () => {
    const result = spawnSync(process.execPath, ["--import", "tsx", fileURLToPath(new URL("../src/cli.ts", import.meta.url)), "--framework", variant], {
      encoding: "utf8", timeout: 10000,
    });
    assert.equal(result.error, undefined);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Unsupported variant|positive safe integer|not implemented/);
  });
}
