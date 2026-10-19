#!/usr/bin/env node
// UserPromptSubmit: snapshot the workspace. Stop: show the change report to the user via systemMessage (0 model tokens;
// no decision/continue fields, so the model is never re-invoked). Silent if returnUser already reported this turn.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { saveSnapshot, takeReport } from "../src/report-core.mjs";

let raw = "";
for await (const c of process.stdin) raw += c;
let input;
try { input = JSON.parse(raw); } catch { process.exit(0); }
const flagFile = process.env.BRANCH_TOGGLE_FLAG ?? join(homedir(), ".claude", "branch-flag");
if (!existsSync(flagFile)) process.exit(0);
const sid = input.session_id, cwd = input.cwd || process.cwd();

if (input.hook_event_name === "UserPromptSubmit") saveSnapshot(sid, cwd);
else if (input.hook_event_name === "Stop") {
  const text = takeReport(sid, cwd);
  if (text) process.stdout.write(JSON.stringify({ systemMessage: text }) + "\n");
}
