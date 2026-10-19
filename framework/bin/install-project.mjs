#!/usr/bin/env node
// Adds/removes the branch framework at PROJECT scope only (<dir>/.mcp.json, <dir>/.claude/settings.json, <dir>/CLAUDE.md).
import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync, rmSync, rmdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const FW = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const flag = (n) => argv.includes(n);
const opt = (n) => (argv.includes(n) ? argv[argv.indexOf(n) + 1] : undefined);
const dir = argv.find((a, i) => !a.startsWith("--") && argv[i - 1] !== "--report");
if (!dir) { console.error("usage: install-project <dir> [--dry-run] [--uninstall] [--script] [--report intent|none]"); process.exit(2); }
const DRY = flag("--dry-run"), UN = flag("--uninstall"), SCRIPT = flag("--script");
const report = opt("--report") ?? process.env.BRANCH_REPORT;
if (report && !["intent", "none"].includes(report)) { console.error(`bad --report ${report}`); process.exit(2); }
const P = resolve(dir);
if (!existsSync(P)) { console.error(`no such dir: ${P}`); process.exit(1); }

// ---- --script mode: generate (or remove) a local ./claude-branch launcher, no config files touched
if (SCRIPT) {
  if (DRY && UN) { console.error("--script is incompatible with --dry-run and --uninstall at the same time"); process.exit(2); }
  const CLAUDE_BRANCH_BIN = join(FW, "bin", "claude-branch");
  const target1 = join(P, "claude-branch");
  const target2 = join(P, "branch");
  const PATTERN = /^#!\/usr\/bin\/env bash\nexec ".*\/bin\/claude-branch" --attach "\$@"\n?$/;
  if (UN) {
    let removed = false;
    for (const t of [target1, target2]) {
      if (existsSync(t) && PATTERN.test(readFileSync(t, "utf8"))) {
        rmSync(t); console.log(`uninstall ${P}\n  ${t}: removed`); removed = true; break;
      }
    }
    if (!removed) console.log(`uninstall ${P}\n  nothing to remove`);
    process.exit(0);
  }
  let target = target1;
  if (existsSync(target1) && !PATTERN.test(readFileSync(target1, "utf8"))) target = target2;
  const content = `#!/usr/bin/env bash\nexec "${CLAUDE_BRANCH_BIN}" --attach "$@"\n`;
  if (DRY) { console.log(`[dry-run] install ${P}\n  ${target}: would write`); }
  else { writeFileSync(target, content); chmodSync(target, 0o755); console.log(`install ${P}\n  ${target}: written`); }
  process.exit(0);
}

const TOOL = "mcp__branch__branch";
const HOOK_CMD = `node "${FW}/bin/return-user-hook.mjs"`;
const REPORT_CMD = `node "${FW}/bin/report-hook.mjs"`;
const REPORT_MODE = report ?? "intent";
// Default to stub: branch disabled at session start; /branch enables it (loads always-mode instructions).
const SYS_MODE = process.env.BRANCH_SYSTEM ?? "stub";
const PROMPT = `${FW}/prompt/.system.${SYS_MODE}-${REPORT_MODE}.md`;
const FULL_PROMPT = `${FW}/prompt/.system.always-${REPORT_MODE}.md`;
const IMPORT = `@${PROMPT}`;
// Match by basename so a moved framework neither leaves stale entries nor gets duplicates.
const hasCmd = (e, name) => (e.hooks ?? []).some((h) => typeof h.command === "string" && h.command.includes(`/bin/${name}`));
const IMPORT_RE = /^@.*\/prompt\/\.system\.(always|stub)-(intent|none)\.md$/;
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
  const ref = (v) => (v?.args ?? []).some((x) => typeof x === "string" && /(^|[\\/])src[\\/]server\.ts$/.test(x));
  const entry = { command: "node", args: ["--import", join(FW, "node_modules", "tsx", "dist", "loader.mjs"), join(FW, "src", "server.ts")] };
  if (UN) {
    if (o.mcpServers?.branch && ref(o.mcpServers.branch)) {
      delete o.mcpServers.branch; if (isEmpty(o.mcpServers)) delete o.mcpServers;
      note(f, "removed mcpServers.branch"); writeJson(f, o);
    }
  } else if (o.mcpServers?.branch && !ref(o.mcpServers.branch)) note(f, "mcpServers.branch already present (not ours, kept)");
  else if (o.mcpServers?.branch && JSON.stringify(o.mcpServers.branch) === JSON.stringify(entry)) note(f, "mcpServers.branch already present");
  else {
    const was = !!o.mcpServers?.branch;
    o.mcpServers = { ...o.mcpServers, branch: entry };
    note(f, was ? "updated mcpServers.branch (framework path changed)" : "added mcpServers.branch"); writeJson(f, o);
  }
}

// ---- .claude/settings.json (+ .claude/branch-install.json: what install added/overwrote, so uninstall reverses only that)
{
  const f = join(P, ".claude", "settings.json"), o = readJson(f);
  const sf = join(P, ".claude", "branch-install.json"), rec = readJson(sf);
  rec.env ??= {};
  let changed = false;
  const hookEntries = (ev) => o.hooks?.[ev] ?? [];
  const isOurs = (e) => e.matcher === TOOL && hasCmd(e, "return-user-hook.mjs");
  const isReport = (e) => hasCmd(e, "report-hook.mjs");
  const dropHooks = (ev, pred) => {
    if (!hookEntries(ev).some(pred)) return false;
    o.hooks[ev] = o.hooks[ev].filter((e) => !pred(e));
    if (!o.hooks[ev].length) delete o.hooks[ev];
    if (isEmpty(o.hooks)) delete o.hooks;
    return true;
  };
  if (UN) {
    if (rec.allowAdded !== false && o.permissions?.allow?.includes(TOOL)) { // legacy installs have no record: remove
      o.permissions.allow = o.permissions.allow.filter((x) => x !== TOOL);
      if (!o.permissions.allow.length) delete o.permissions.allow;
      if (isEmpty(o.permissions)) delete o.permissions;
      note(f, "removed permission allow " + TOOL); changed = true;
    }
    if (dropHooks("PostToolUse", isOurs)) { note(f, "removed PostToolUse hook"); changed = true; }
    for (const ev of ["UserPromptSubmit", "Stop"]) if (dropHooks(ev, isReport)) { note(f, `removed ${ev} hook`); changed = true; }
    for (const k of ["ENABLE_TOOL_SEARCH", "BRANCH_FW", "BRANCH_TRACE_DIR", "BRANCH_TOGGLE_FLAG", "BRANCH_FW_FULL_PROMPT", "BRANCH_REPORT"]) if (o.env && k in o.env) {
      const r = rec.env[k];
      if (r && "prev" in r) { o.env[k] = r.prev; note(f, `restored env.${k}=${r.prev}`); changed = true; }
      else if (!r || r.added) { delete o.env[k]; note(f, `removed env.${k}`); changed = true; }
    }
    if (o.env && isEmpty(o.env)) delete o.env;
  } else {
    const allow = o.permissions?.allow;
    if (!allow?.includes(TOOL)) { o.permissions ??= {}; (o.permissions.allow ??= []).push(TOOL); rec.allowAdded = true; note(f, "added permission allow " + TOOL); changed = true; }
    else rec.allowAdded ??= false;
    o.hooks ??= {};
    const ensure = (ev, pred, entry, label) => {
      const cur = hookEntries(ev).find(pred);
      if (!cur) { (o.hooks[ev] ??= []).push(entry); note(f, `added ${label} hook`); changed = true; return; }
      const h = cur.hooks.find((x) => typeof x.command === "string" && x.command.includes(`/bin/${label === "PostToolUse" ? "return-user-hook.mjs" : "report-hook.mjs"}`));
      if (h.command !== entry.hooks[0].command) { h.command = entry.hooks[0].command; note(f, `updated ${label} hook command`); changed = true; }
    };
    ensure("PostToolUse", isOurs, { matcher: TOOL, hooks: [{ type: "command", command: HOOK_CMD }] }, "PostToolUse");
    for (const ev of ["UserPromptSubmit", "Stop"]) ensure(ev, isReport, { hooks: [{ type: "command", command: REPORT_CMD }] }, ev);
    if (isEmpty(o.hooks)) delete o.hooks;
    o.env ??= {};
    const traceDir = join(P, ".branch-traces");
    const want = {
      ENABLE_TOOL_SEARCH: "false",
      BRANCH_FW: FW,
      BRANCH_TRACE_DIR: traceDir,
      BRANCH_TOGGLE_FLAG: join(traceDir, "enabled"),
      BRANCH_FW_FULL_PROMPT: FULL_PROMPT,
      ...(report ? { BRANCH_REPORT: report } : {}),
    };
    for (const [k, v] of Object.entries(want)) if (o.env[k] !== v) {
      if (!rec.env[k]) rec.env[k] = k in o.env ? { prev: o.env[k] } : { added: true };
      note(f, `${k in o.env ? "changed" : "added"} env.${k}=${v}${k in o.env ? ` (was ${o.env[k]})` : ""}`); o.env[k] = v; changed = true;
    }
    if (isEmpty(o.env)) delete o.env;
    if (!DRY && changed) { mkdirSync(dirname(sf), { recursive: true }); writeFileSync(sf, JSON.stringify(rec, null, 2) + "\n"); }
  }
  if (changed) writeJson(f, o); else if (!UN) note(f, "nothing to change");
  if (UN && !DRY && existsSync(sf)) { rmSync(sf); try { rmdirSync(dirname(sf)); } catch { /* not empty */ } }
}

// ---- CLAUDE.md import line (one per project, pointing at its own mode's prompt file)
{
  const f = join(P, "CLAUDE.md");
  const txt = existsSync(f) ? readFileSync(f, "utf8") : "";
  const ls = txt.split("\n");
  const idx = ls.findIndex((l) => IMPORT_RE.test(l.trim()));
  if (UN) {
    if (idx >= 0) {
      const out = ls.filter((l) => !IMPORT_RE.test(l.trim())).join("\n");
      note(f, "removed import line"); if (!DRY) { if (out.trim() === "") rmSync(f); else writeFileSync(f, out); }
    }
  } else if (idx >= 0 && ls[idx].trim() === IMPORT) note(f, "import line already present");
  else if (idx >= 0) {
    note(f, `updated import line to ${IMPORT}`);
    if (!DRY) { ls[idx] = IMPORT; writeFileSync(f, ls.join("\n")); }
  } else {
    note(f, `added line ${IMPORT}`);
    if (!DRY) writeFileSync(f, txt + (txt && !txt.endsWith("\n") ? "\n" : "") + IMPORT + "\n");
  }
}

// ---- prompt files (stub for the CLAUDE.md import; always-mode for /branch to load)
if (!UN) {
  if (DRY) { note(PROMPT, "would run build-prompt"); if (SYS_MODE === "stub") note(FULL_PROMPT, "would run build-prompt (always mode)"); }
  else {
    execFileSync(join(FW, "bin", "build-prompt"), { env: { ...process.env, BRANCH_SYSTEM: SYS_MODE, BRANCH_REPORT: REPORT_MODE } }); note(PROMPT, "built");
    if (SYS_MODE === "stub") { execFileSync(join(FW, "bin", "build-prompt"), { env: { ...process.env, BRANCH_SYSTEM: "always", BRANCH_REPORT: REPORT_MODE } }); note(FULL_PROMPT, "built (always mode for /branch)"); }
  }
}

// ---- .claude/commands/branch.md and nobranch.md
{
  const cmdsDir = join(P, ".claude", "commands");
  const fwCmds = join(FW, "commands");
  for (const name of ["branch", "nobranch"]) {
    const src = join(fwCmds, `${name}.md`), dst = join(cmdsDir, `${name}.md`);
    if (UN) {
      const existed = existsSync(dst);
      if (!DRY && existed) rmSync(dst);
      if (existed) note(dst, "removed");
    } else {
      if (!DRY) { mkdirSync(cmdsDir, { recursive: true }); writeFileSync(dst, readFileSync(src, "utf8")); }
      note(dst, existsSync(dst) ? "updated command" : "installed command");
    }
  }
  // On uninstall, try to remove the now-empty commands dir and then .claude/ (the settings section
  // already tried .claude/ once, but it still had commands/ in it — try again now).
  if (UN && !DRY) {
    try { rmdirSync(cmdsDir); } catch { /* not empty */ }
    try { rmdirSync(join(P, ".claude")); } catch { /* not empty */ }
  }
}

console.log(`${DRY ? "[dry-run] " : ""}${UN ? "uninstall" : "install"} ${P}`);
console.log(log.length ? log.map((l) => "  " + l).join("\n") : "  nothing to change");
if (!UN && !DRY) console.log("Note: Claude Code asks to approve the project MCP server and the external @import on first use.");
