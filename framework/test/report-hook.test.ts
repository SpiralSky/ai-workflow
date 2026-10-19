import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, mkdirSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { recordTests } from "../src/report.js";

const bin = (n: string) => fileURLToPath(new URL(`../bin/${n}`, import.meta.url));
const MSG = "<<RETURN_USER>>\ndone\n[bash:0 → returnUser]\n(Delivered to user. Do not repeat it; end your turn.)";

function setup() {
  const ws = mkdtempSync(join(tmpdir(), "ws-")), td = mkdtempSync(join(tmpdir(), "td-"));
  writeFileSync(join(ws, "a.py"), "x = 1\n");
  const flagFile = join(td, "branch-flag");
  writeFileSync(flagFile, "");
  const env = { ...process.env, BRANCH_TRACE_DIR: td, BRANCH_TOGGLE_FLAG: flagFile };
  const run = (script: string, input: object) => {
    const r = spawnSync("node", [bin(script)], { input: JSON.stringify({ session_id: "s1", cwd: ws, ...input }), encoding: "utf8", env });
    assert.equal(r.status, 0, r.stderr);
    return r.stdout;
  };
  const traces = () => readdirSync(td).filter((f) => f.endsWith(".jsonl")).flatMap((f) => readFileSync(join(td, f), "utf8").trim().split("\n")).map((l) => JSON.parse(l));
  const cleanup = () => { rmSync(ws, { recursive: true, force: true }); rmSync(td, { recursive: true, force: true }); };
  return { ws, td, env, run, traces, cleanup };
}

test("Stop hook: systemMessage with diff + tests, no blocking fields", () => {
  const t = setup();
  try {
    t.run("report-hook.mjs", { hook_event_name: "UserPromptSubmit" });
    writeFileSync(join(t.ws, "a.py"), "x = 2\ny = 3\n"); // built-in Edit/Bash style change
    const old = process.env.BRANCH_TRACE_DIR; process.env.BRANCH_TRACE_DIR = t.td;
    try { recordTests(t.ws, true); } finally { if (old === undefined) delete process.env.BRANCH_TRACE_DIR; else process.env.BRANCH_TRACE_DIR = old; }
    const out = JSON.parse(t.run("report-hook.mjs", { hook_event_name: "Stop" }));
    assert.deepEqual(out, { systemMessage: "Changes: a.py (+2 −1) · tests: ok" });
    assert.deepEqual(t.traces().map((e) => [e.type, e.text]), [["report", out.systemMessage]]);
    assert.equal(t.run("report-hook.mjs", { hook_event_name: "Stop" }), ""); // second Stop: nothing
  } finally { t.cleanup(); }
});

test("Stop hook: silent without changes or without snapshot; no tests part if none ran", () => {
  const t = setup();
  try {
    assert.equal(t.run("report-hook.mjs", { hook_event_name: "Stop" }), "");
    t.run("report-hook.mjs", { hook_event_name: "UserPromptSubmit" });
    assert.equal(t.run("report-hook.mjs", { hook_event_name: "Stop" }), "");
    t.run("report-hook.mjs", { hook_event_name: "UserPromptSubmit" });
    writeFileSync(join(t.ws, "b.py"), "1\n");
    assert.equal(JSON.parse(t.run("report-hook.mjs", { hook_event_name: "Stop" })).systemMessage, "Changes: b.py (+1 −0)");
  } finally { t.cleanup(); }
});

test("returnUser hook appends the report once; Stop hook then stays silent", () => {
  const t = setup();
  try {
    t.run("report-hook.mjs", { hook_event_name: "UserPromptSubmit" });
    writeFileSync(join(t.ws, "a.py"), "x = 9\n");
    const out = JSON.parse(t.run("return-user-hook.mjs", { hook_event_name: "PostToolUse", tool_response: MSG }));
    assert.equal(out.continue, false);
    assert.equal(out.stopReason, "done\n\nChanges: a.py (+1 −1)");
    assert.equal(t.run("report-hook.mjs", { hook_event_name: "Stop" }), "");
    assert.equal(t.traces().filter((e) => e.type === "report").length, 1);
    // next turn reports again
    t.run("report-hook.mjs", { hook_event_name: "UserPromptSubmit" });
    const out2 = JSON.parse(t.run("return-user-hook.mjs", { tool_response: MSG }));
    assert.equal(out2.stopReason, "done\n\nNo file changes.");
  } finally { t.cleanup(); }
});

test("Stop hook with cd'd cwd reports real changes, not deletions", () => {
  const t = setup();
  try {
    mkdirSync(join(t.ws, "sub")); writeFileSync(join(t.ws, "sub", "c.py"), "1\n");
    t.run("report-hook.mjs", { hook_event_name: "UserPromptSubmit" });
    writeFileSync(join(t.ws, "a.py"), "x = 2\n");
    const out = JSON.parse(t.run("report-hook.mjs", { hook_event_name: "Stop", cwd: join(t.ws, "sub") }));
    assert.equal(out.systemMessage, "Changes: a.py (+1 −1)");
  } finally { t.cleanup(); }
});
