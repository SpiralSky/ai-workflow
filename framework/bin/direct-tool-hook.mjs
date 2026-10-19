#!/usr/bin/env node
// PreToolUse hook: deny Edit and Write when BRANCH_ENFORCE_EDITS=1, redirecting the model to use branch() instead.
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
let raw = "";
for await (const c of process.stdin) raw += c;

let input;
try { input = JSON.parse(raw); } catch { process.exit(0); }

const flagFile = process.env.BRANCH_TOGGLE_FLAG ?? join(homedir(), ".claude", "branch-flag");
if (!existsSync(flagFile)) process.exit(0);

const tool = input.tool_name;
if (tool !== "Edit" && tool !== "Write") process.exit(0);
if (process.env.BRANCH_ENFORCE_EDITS !== "1") process.exit(0);

const reason = `Direct ${tool} is blocked. Use branch() instead:\n` +
  `await edit(file, old, new); const t = await runTests(); if (t.ok) returnUser(msg); return t.failures;`;

process.stdout.write(JSON.stringify({
  hookSpecificOutput: {
    hookEventName: "PreToolUse",
    permissionDecision: "deny",
    permissionDecisionReason: reason,
  },
}) + "\n");
