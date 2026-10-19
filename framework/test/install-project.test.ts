import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const bin = fileURLToPath(new URL("../bin/install-project.mjs", import.meta.url));
const run = (...a: string[]) => {
  const r = spawnSync("node", [bin, ...a], { encoding: "utf8" });
  assert.equal(r.status, 0, r.stderr);
  return r.stdout;
};
const tree = (d: string): Record<string, string> => {
  const out: Record<string, string> = {};
  const walk = (rel: string) => {
    for (const e of readdirSync(join(d, rel), { withFileTypes: true })) {
      const r = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(r); else out[r] = readFileSync(join(d, r), "utf8");
    }
  };
  walk("");
  return out;
};

test("install / dry-run / uninstall restore pre-existing project config", () => {
  const p = mkdtempSync(join(tmpdir(), "proj-"));
  try {
    mkdirSync(join(p, ".claude"));
    const settings = { permissions: { allow: ["mcp__branch__branch", "Bash(ls)"] }, env: { ENABLE_TOOL_SEARCH: "auto", FOO: "1" }, hooks: { Stop: [{ hooks: [{ type: "command", command: "echo hi" }] }] } };
    writeFileSync(join(p, ".claude", "settings.json"), JSON.stringify(settings, null, 2) + "\n");
    writeFileSync(join(p, "CLAUDE.md"), "# mine\n");
    const before = tree(p);

    run(p, "--dry-run");
    assert.deepEqual(tree(p), before); // dry-run writes nothing

    run(p, "--report", "none");
    const s = JSON.parse(readFileSync(join(p, ".claude", "settings.json"), "utf8"));
    assert.equal(s.env.ENABLE_TOOL_SEARCH, "false");
    assert.match(s.hooks.PostToolUse[0].hooks[0].command, /^node ".*return-user-hook\.mjs"$/);
    assert.match(readFileSync(join(p, "CLAUDE.md"), "utf8"), /prompt\/\.system\.stub-none\.md/);
    assert.ok(existsSync(join(p, ".claude", "commands", "branch.md")));
    assert.ok(existsSync(join(p, ".claude", "commands", "nobranch.md")));
    assert.ok(JSON.parse(readFileSync(join(p, ".mcp.json"), "utf8")).mcpServers.branch);
    const again = tree(p);
    run(p, "--report", "none"); // idempotent
    assert.deepEqual(tree(p), again);

    run(p, "--uninstall");
    assert.deepEqual(tree(p), before);
  } finally { rmSync(p, { recursive: true, force: true }); }
});

test("uninstall on a fresh project removes everything", () => {
  const p = mkdtempSync(join(tmpdir(), "proj-"));
  try {
    run(p);
    assert.ok(existsSync(join(p, ".mcp.json")));
    run(p, "--uninstall");
    assert.deepEqual(tree(p), {});
  } finally { rmSync(p, { recursive: true, force: true }); }
});
