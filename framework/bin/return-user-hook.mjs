#!/usr/bin/env node
// PostToolUse hook: when the branch tool returned <<RETURN_USER>>, stop the turn and deliver the message once.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { takeReport } from "../src/report-core.mjs";
const MARKER = "<<RETURN_USER>>";

let raw = "";
for await (const c of process.stdin) raw += c;

let input;
try { input = JSON.parse(raw); } catch { process.exit(0); }

const flagFile = process.env.BRANCH_TOGGLE_FLAG ?? join(homedir(), ".claude", "branch-flag");
if (!existsSync(flagFile)) process.exit(0);

const texts = (r) => {
  if (typeof r === "string") return [r];
  if (Array.isArray(r)) return r.flatMap((x) => (typeof x === "string" ? [x] : typeof x?.text === "string" ? [x.text] : []));
  if (r && typeof r === "object") return r.content !== undefined ? texts(r.content) : typeof r.text === "string" ? [r.text] : [];
  return [];
};

const text = texts(input.tool_response).find((t) => t.includes(MARKER));
if (text === undefined) process.exit(0);

let lines = text.slice(text.indexOf(MARKER) + MARKER.length).replace(/^\r?\n/, "").split("\n");
while (lines.length && lines[lines.length - 1].trim() === "") lines.pop();
if (lines.length && lines[lines.length - 1].startsWith("(Delivered")) lines.pop();
if (lines.length > 1 && /^\[.*\]$/.test(lines[lines.length - 1].trim())) lines.pop();

// continue:false skips the Stop hook, so the change report is appended here (takeReport marks it delivered: exactly once per turn).
const report = takeReport(input.session_id, input.cwd || process.cwd(), true);
const message = lines.join("\n") + (report ? `\n\n${report}` : "");

// stopReason is rendered once by the TUI ("hook stopped continuation: <msg>"); replacing the tool output
// removes the marker and avoids a second copy of the message. continue:false ends the turn without a model call.
process.stdout.write(JSON.stringify({
  continue: false,
  stopReason: message,
  hookSpecificOutput: { hookEventName: "PostToolUse", updatedMCPToolOutput: "Delivered to user." },
}) + "\n");
