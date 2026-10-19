import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const hook = fileURLToPath(new URL("../bin/return-user-hook.mjs", import.meta.url));
const run = (input: unknown) => {
  const td = mkdtempSync(join(tmpdir(), "td-"));
  const flagFile = join(td, "branch-flag");
  writeFileSync(flagFile, "");
  const r = spawnSync("node", [hook], { input: typeof input === "string" ? input : JSON.stringify(input), encoding: "utf8", env: { ...process.env, BRANCH_TRACE_DIR: td, BRANCH_TOGGLE_FLAG: flagFile } });
  rmSync(td, { recursive: true, force: true });
  assert.equal(r.status, 0);
  return r.stdout;
};
const body = "<<RETURN_USER>>\nline one\nline two\n[bash:0 → returnUser]\n(Delivered to user. Do not repeat it; end your turn.)";

for (const [name, tool_response] of [
  ["string", body],
  ["array", [{ type: "text", text: body }]],
  ["object with content", { content: [{ type: "text", text: body }] }],
] as const) {
  test(`stops on marker (${name})`, () => {
    const out = JSON.parse(run({ tool_name: "mcp__branch__branch", tool_response }));
    assert.deepEqual(out, {
      continue: false,
      stopReason: "line one\nline two",
      hookSpecificOutput: { hookEventName: "PostToolUse", updatedMCPToolOutput: "Delivered to user." },
    });
  });
}

test("silent without marker", () => {
  assert.equal(run({ tool_response: [{ type: "text", text: "hello\n[no calls]" }] }), "");
  assert.equal(run({}), "");
  assert.equal(run("not json"), "");
});
