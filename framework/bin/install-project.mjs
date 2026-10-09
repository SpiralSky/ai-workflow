#!/usr/bin/env node
// Adds/removes the branch framework at PROJECT scope only (<dir>/.mcp.json, <dir>/.claude/settings.json, <dir>/CLAUDE.md).
import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FW = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const dir = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--report");
if (!dir) { console.error("usage: install-project <dir> [--dry-run] [--uninstall] [--report intent|none]"); process.exit(2); }
const DRY = flag("--dry-run"), UN = flag("--uninstall");
const report = opt("--report") ?? process.env.BRANCH_REPORT;
if (report && !["intent", "none"].includes(report)) { console.error(`bad --report ${report}`); process.exit(2); }
const P = resolve(dir);
if (!existsSync(P)) { console.error(`no such dir: ${P}`); process.exit(1); }

const TOOL = "mcp__branch__branch";
const HOOK_CMD = `node ${FW}/bin/return-user-hook.mjs`;
const REPORT_CMD = `node ${FW}/bin/report-hook.mjs`;
const IMPORT = `@${FW}/prompt/.system.full.md`;
const log = [];
const note = (f, msg) => log.push(`${f}: ${msg}`);

const readJson = (f) => { if (!existsSync(f)) return {}; try { return JSON.parse(readFileSync(f, "utf8")); } catch { console.error(`cannot parse ${f}; refusing to touch it`); process.exit(1); } };
const isEmpty = (o) => Object.keys(o).length === 0;
const writeJson = (f, o) => {
  if (DRY) return;
  if (UN && isEmpty(o)) { rmSync(f, { force: true }); return; }
  mkdirSync(dirname(f), { recursive: true });
  writeFileSync(f, JSON.stringify(o, null, 2) + "\n");
};

// ---- .mcp.json
{
  const f = join(P, ".mcp.json"), o = readJson(f);
  const ref = (s) => JSON.stringify(s?.args ?? []).includes(`${FW}/src/server.ts`);
  if (UN) {
    if (o.mcpServers?.branch && ref(o.mcpServers.branch)) {
      delete o.mcpServers.branch; if (isEmpty(o.mcpServers)) delete o.mcpServers;
      note(f, "removed mcpServers.branch"); writeJson(f, o);
    }
  } else if (o.mcpServers?.branch) note(f, "mcpServers.branch already present (kept)");
  else {
    if (!existsSync(join(FW, "mcp.json"))) execFileSync(join(FW, "bin", "gen-config"));
    o.mcpServers = { ...o.mcpServers, branch: readJson(join(FW, "mcp.json")).mcpServers.branch };
    note(f, "added mcpServers.branch"); writeJson(f, o);
  }
}

// ---- .claude/settings.json
{
  const f = join(P, ".claude", "settings.json"), o = readJson(f);
  let changed = false;
  const hookEntries = () => o.hooks?.PostToolUse ?? [];
  const isOurs = (e) => e.matcher === TOOL && (e.hooks ?? []).some((h) => h.command === HOOK_CMD);
  const isReport = (e) => (e.hooks ?? []).some((h) => h.command === REPORT_CMD);
  if (UN) {
    if (o.permissions?.allow?.includes(TOOL)) {
      o.permissions.allow = o.permissions.allow.filter((x) => x !== TOOL);
      if (!o.permissions.allow.length) delete o.permissions.allow;
      if (isEmpty(o.permissions)) delete o.permissions;
      note(f, "removed permission allow " + TOOL); changed = true;
    }
    if (hookEntries().some(isOurs)) {
      o.hooks.PostToolUse = hookEntries().filter((e) => !isOurs(e));
      if (!o.hooks.PostToolUse.length) delete o.hooks.PostToolUse;
      if (isEmpty(o.hooks)) delete o.hooks;
      note(f, "removed PostToolUse hook"); changed = true;
    }
    for (const ev of ["UserPromptSubmit", "Stop"]) if ((o.hooks?.[ev] ?? []).some(isReport)) {
      o.hooks[ev] = o.hooks[ev].filter((e) => !isReport(e));
      if (!o.hooks[ev].length) delete o.hooks[ev];
      if (isEmpty(o.hooks)) delete o.hooks;
      note(f, `removed ${ev} hook`); changed = true;
    }
    for (const k of ["ENABLE_TOOL_SEARCH", "BRANCH_REPORT"]) if (o.env && k in o.env) {
      delete o.env[k]; note(f, `removed env.${k}`); changed = true;
    }
    if (o.env && isEmpty(o.env)) delete o.env;
  } else {
    o.permissions ??= {}; o.permissions.allow ??= [];
    if (!o.permissions.allow.includes(TOOL)) { o.permissions.allow.push(TOOL); note(f, "added permission allow " + TOOL); changed = true; }
    o.hooks ??= {}; o.hooks.PostToolUse ??= [];
    if (!hookEntries().some(isOurs)) { o.hooks.PostToolUse.push({ matcher: TOOL, hooks: [{ type: "command", command: HOOK_CMD }] }); note(f, "added PostToolUse hook"); changed = true; }
    for (const ev of ["UserPromptSubmit", "Stop"]) {
      o.hooks[ev] ??= [];
      if (!o.hooks[ev].some(isReport)) { o.hooks[ev].push({ hooks: [{ type: "command", command: REPORT_CMD }] }); note(f, `added ${ev} hook`); changed = true; }
    }
    o.env ??= {};
    const want = { ENABLE_TOOL_SEARCH: "false", ...(report ? { BRANCH_REPORT: report } : {}) };
    for (const [k, v] of Object.entries(want)) if (o.env[k] !== v) {
      note(f, `${k in o.env ? "changed" : "added"} env.${k}=${v}${k in o.env ? ` (was ${o.env[k]})` : ""}`); o.env[k] = v; changed = true;
    }
  }
  if (changed) writeJson(f, o); else if (!UN) note(f, "nothing to change");
}

// ---- CLAUDE.md import line
{
  const f = join(P, "CLAUDE.md");
  const txt = existsSync(f) ? readFileSync(f, "utf8") : "";
  const has = txt.split("\n").some((l) => l.trim() === IMPORT);
  if (UN) {
    if (has) {
      const out = txt.split("\n").filter((l) => l.trim() !== IMPORT).join("\n");
      note(f, "removed import line"); if (!DRY) { if (out.trim() === "") rmSync(f); else writeFileSync(f, out); }
    }
  } else if (has) note(f, "import line already present");
  else {
    note(f, `added line ${IMPORT}`);
    if (!DRY) writeFileSync(f, txt + (txt && !txt.endsWith("\n") ? "\n" : "") + IMPORT + "\n");
  }
}

// ---- prompt file the import points at (built for the chosen mode)
if (!UN) {
  if (DRY) note(`${FW}/prompt/.system.full.md`, `would run build-prompt (BRANCH_REPORT=${report ?? "intent"})`);
  else { execFileSync(join(FW, "bin", "build-prompt"), { env: { ...process.env, BRANCH_REPORT: report ?? process.env.BRANCH_REPORT ?? "intent" } }); note(`${FW}/prompt/.system.full.md`, "built"); }
}

console.log(`${DRY ? "[dry-run] " : ""}${UN ? "uninstall" : "install"} ${P}`);
console.log(log.length ? log.map((l) => "  " + l).join("\n") : "  nothing to change");
if (!UN && !DRY) console.log("Note: Claude Code asks to approve the project MCP server and the external @import on first use.");
