#!/usr/bin/env node
// experiments/viewer/build-data.mjs
import { readdirSync, readFileSync, existsSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const RUNS_DIR = join(__dirname, '..', 'runs');
const OUT = join(__dirname, 'data.js');

const PROBLEMS = {
  '01': 'chunk off-by-one', '02': 'inventory feature', '03': 'discount mismatch',
  '04': 'vague rate limit', '05': 'report refactor', '06': 'import cycle',
  '07': 'async race', '08': 'api mismatch', '09': 'cache invalidation'
};

function parseJsonlLines(text) {
  return text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
}

const BRANCH_TOOL_NAMES = new Set(['mcp__branch__branch', 'mcp__plugin_branch-framework_branch__branch', 'branch']);

function parseBranchInput(input) {
  if (!input || typeof input !== 'object') return null;
  if (input.intent !== undefined || input.code !== undefined) return { intent: input.intent || '', code: input.code || '' };
  return null;
}

function parseClaudeTranscript(events) {
  const msgs = [];
  for (const e of events) {
    if (e.type === 'assistant') {
      const content = (e.message?.content ?? []).filter(c => c.type !== 'thinking');
      if (!content.length) continue;
      msgs.push({ role: 'assistant', content: content.map(c => {
        if (c.type === 'text') return { type: 'text', text: c.text || '' };
        if (c.type === 'tool_use') {
          const bp = BRANCH_TOOL_NAMES.has(c.name) ? parseBranchInput(c.input) : null;
          if (bp) return { type: 'branch_program', name: c.name, intent: bp.intent, code: bp.code, id: c.id };
          return { type: 'tool_use', name: c.name, input: JSON.stringify(c.input || {}, null, 2), id: c.id };
        }
        return { type: c.type };
      })});
    } else if (e.type === 'user') {
      const content = e.message?.content ?? [];
      if (!content.length) continue;
      const filtered = content.map(c => {
        if (c.type === 'tool_result') return { type: 'tool_result', tool_use_id: c.tool_use_id, content: typeof c.content === 'string' ? c.content : JSON.stringify(c.content) };
        if (c.type === 'text') return { type: 'text', text: c.text || '' };
        return null;
      }).filter(Boolean);
      if (filtered.length) msgs.push({ role: 'user', content: filtered });
    }
  }
  return msgs;
}

function parseOpenAITranscript(events) {
  const msgs = [];
  for (const e of events) {
    if (e.type === 'assistant_message') {
      const msg = e.message;
      const content = [];
      if (msg.content) content.push({ type: 'text', text: String(msg.content) });
      for (const tc of (msg.tool_calls || [])) {
        const name = tc.function?.name || '?';
        const args = tc.function?.arguments || '{}';
        const bp = BRANCH_TOOL_NAMES.has(name) ? (() => { try { return parseBranchInput(JSON.parse(args)); } catch { return null; } })() : null;
        if (bp) content.push({ type: 'branch_program', name, intent: bp.intent, code: bp.code, id: tc.id });
        else content.push({ type: 'tool_use', name, input: args, id: tc.id });
      }
      if (content.length) msgs.push({ role: 'assistant', content });
    } else if (e.type === 'tool_results') {
      for (const r of (e.results || [])) {
        msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: r.tool_call_id, content: String(r.content || '') }] });
      }
    } else if (e.type === 'tool_result') {
      msgs.push({ role: 'user', content: [{ type: 'tool_result', tool_use_id: e.tool_call_id, content: String(e.result || '') }] });
    }
  }
  return msgs;
}

function parseTraces(runsDir, runDir, tag) {
  const tracesFile = join(runsDir, runDir, tag + '.traces.jsonl');
  if (!existsSync(tracesFile)) return [];
  try {
    const text = readFileSync(tracesFile, 'utf8');
    return text.split('\n').filter(Boolean).map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
  } catch { return []; }
}

// Load all child jsonls in a run dir, keyed by parentTag.
// Child files are named <timestamp>-child-<pid>.jsonl and start with a session event carrying parentTag.
function loadChildSessions(runsDir, runDir) {
  const dir = join(runsDir, runDir);
  let files; try { files = readdirSync(dir); } catch { return {}; }
  const byTag = {};
  for (const f of files) {
    if (!f.endsWith('.jsonl') || !f.includes('-child-')) continue;
    try {
      const lines = readFileSync(join(dir, f), 'utf8').split('\n').filter(Boolean);
      const events = lines.map(l => { try { return JSON.parse(l); } catch { return null; } }).filter(Boolean);
      const sessionEv = events.find(e => e.type === 'session');
      const parentTag = sessionEv?.parentTag;
      if (!parentTag) continue;
      if (!byTag[parentTag]) byTag[parentTag] = [];
      // Build a compact event list for the viewer
      const compact = [];
      let turn = 0;
      for (const e of events) {
        if (e.type === 'llm') {
          compact.push({ kind: 'llm', turn: ++turn, inChars: e.promptChars || 0, outChars: e.outChars || 0, ms: e.ms || 0 });
        } else if (e.type === 'call') {
          const argStr = typeof e.args === 'string' ? e.args : JSON.stringify(e.args ?? '');
          const resultStr = typeof e.result === 'string' ? e.result : JSON.stringify(e.result ?? '');
          const errStr = e.error ? String(e.error) : null;
          compact.push({ kind: 'call', name: e.name, args: argStr.slice(0, 120), result: errStr ? null : resultStr.slice(0, 200), error: errStr?.slice(0, 200), ms: e.ms || 0 });
        } else if (e.type === 'user') {
          compact.push({ kind: 'returnUser', text: (e.text || '').slice(0, 300) });
        }
      }
      byTag[parentTag].push(compact);
    } catch {}
  }
  return byTag;
}

function processRun(runsDir, runDir, tag) {
  const jsonlPath = join(runsDir, runDir, tag + '.jsonl');
  if (!existsSync(jsonlPath)) return null;

  let meta = {};
  const metaPath = join(runsDir, runDir, tag + '.meta.json');
  if (!existsSync(metaPath)) { console.warn('Skipping (no meta.json):', tag); return null; }
  try { meta = JSON.parse(readFileSync(metaPath, 'utf8')); } catch {}

  const final = existsSync(join(runsDir, runDir, tag + '.final.txt')) ? readFileSync(join(runsDir, runDir, tag + '.final.txt'), 'utf8').trim() : '';
  const tests = existsSync(join(runsDir, runDir, tag + '.tests.txt')) ? readFileSync(join(runsDir, runDir, tag + '.tests.txt'), 'utf8').trim() : '';
  const stderr = existsSync(join(runsDir, runDir, tag + '.stderr')) ? readFileSync(join(runsDir, runDir, tag + '.stderr'), 'utf8').trim() : '';

  const rawJsonl = readFileSync(jsonlPath, 'utf8');
  const events = parseJsonlLines(rawJsonl);

  const hasClaudeEvents = events.some(e => e.type === 'system' || (e.type === 'assistant' && e.message));
  const hasOpenAIEvents = events.some(e => e.type === 'turn');
  const provider = meta.backend || meta.provider || (hasClaudeEvents ? 'claude' : hasOpenAIEvents ? 'openai' : 'unknown');

  const hasExtendedMeta = meta.turns !== undefined;
  let turns, cost, inTok, outTok, cacheR, subCost, durationMs, branchCalls, delegateCalls,
      orchestrateTurns, returnUser, msgChars, failReason, secondaryInputTok, secondaryOutputTok, totalTok;
  if (hasExtendedMeta) {
    turns = meta.turns; cost = meta.cost ?? 0; inTok = meta.inputTok ?? 0; outTok = meta.outputTok ?? 0;
    cacheR = meta.cacheRead ?? 0; subCost = meta.subCost ?? 0; durationMs = meta.durationMs ?? 0;
    branchCalls = meta.branchCalls ?? 0; delegateCalls = meta.delegateCalls ?? 0;
    orchestrateTurns = meta.orchestrateTurns ?? 0; returnUser = meta.returnUser ?? false;
    msgChars = meta.msgChars ?? 0; failReason = meta.failReason ?? null;
    secondaryInputTok = meta.secondaryInputTok ?? 0; secondaryOutputTok = meta.secondaryOutputTok ?? 0;
    totalTok = meta.totalTok ?? (inTok + outTok + secondaryInputTok + secondaryOutputTok);
  } else {
    const result = events.find(e => e.type === 'result');
    turns = result?.num_turns ?? events.filter(e => e.type === 'turn').length;
    cost = result?.total_cost_usd ?? 0;
    const usage = result?.usage ?? {};
    inTok = usage.input_tokens ?? 0; outTok = usage.output_tokens ?? 0; cacheR = usage.cache_read_input_tokens ?? 0;
    subCost = 0; durationMs = 0; branchCalls = 0; delegateCalls = 0;
    orchestrateTurns = 0; returnUser = false; msgChars = 0; failReason = null;
    secondaryInputTok = 0; secondaryOutputTok = 0; totalTok = inTok + outTok;
  }

  let model = meta.model || 'unknown';
  if (provider === 'claude' && model === 'unknown') {
    const sysInit = events.find(e => e.type === 'system' && e.subtype === 'init');
    if (sysInit?.model) model = sysInit.model;
  }

  const hasTranscript = provider === 'claude' ? events.some(e => e.type === 'assistant') : events.some(e => e.type === 'assistant_message');
  const transcript = hasTranscript ? (provider === 'claude' ? parseClaudeTranscript(events) : parseOpenAITranscript(events)) : null;

  const parts = tag.match(/^(\d{2})-(.+)-(\d+)$/);
  const pid = parts?.[1] ?? '??';
  const mode = meta.mode || (parts?.[2] ?? 'unknown');
  const runNum = parseInt(parts?.[3] ?? '1');

  const testLines = tests.split('\n');
  const pass = testLines.some(l => l === 'OK' || l.match(/^OK \(/)) && !testLines.some(l => l.match(/^FAILED/));

  const traces = parseTraces(runsDir, runDir, tag);

  return { id: `${runDir}:${tag}`, pid, desc: PROBLEMS[pid] || pid, run: runNum, mode, model, provider, pass, turns, cost,
    in_tok: inTok, out_tok: outTok, cache_r: cacheR,
    subCost, durationMs, branchCalls, delegateCalls, orchestrateTurns, returnUser, msgChars, failReason,
    secondaryInputTok, secondaryOutputTok, totalTok,
    final, tests, stderr, transcript, traces, runDir, prompt: meta.prompt || '',
    childSessions: null }; // filled in by buildData after all runs processed
}

function buildData() {
  if (!existsSync(RUNS_DIR)) { console.error('No runs directory at', RUNS_DIR); process.exit(1); }

  const runDirs = readdirSync(RUNS_DIR).filter(d => /^\d{4}-/.test(d)).sort();
  const allRuns = [];

  // Cache child sessions per run dir to avoid re-parsing for each run tag.
  const childSessionCache = {};

  for (const runDir of runDirs) {
    let files; try { files = readdirSync(join(RUNS_DIR, runDir)); } catch { continue; }
    const tags = files.filter(f => f.endsWith('.jsonl') && !f.endsWith('.traces.jsonl') && !f.endsWith('-branch.jsonl') && !/^hook-/.test(f) && !/^\d{4}-\d{2}-\d{2}T/.test(f)).map(f => f.replace(/\.jsonl$/, ''));
    for (const tag of tags) {
      const r = processRun(RUNS_DIR, runDir, tag);
      if (!r) continue;
      if (r.mode === 'orchestrate') {
        if (!childSessionCache[runDir]) childSessionCache[runDir] = loadChildSessions(RUNS_DIR, runDir);
        r.childSessions = childSessionCache[runDir][tag] || [];
      }
      allRuns.push(r);
    }
  }

  const datasets = {};
  for (const run of allRuns) {
    const ms = run.model.replace('claude-', '').replace('-instruct', '').replace('qwen/qwen-2.5-', 'qwen2.5-').replace('-latest', '');
    const key = run.mode === 'openai' ? ms : `${ms}-${run.mode}`;
    if (!datasets[key]) datasets[key] = { key, model: run.model, mode: run.mode, provider: run.provider, runs: [] };
    datasets[key].runs.push(run);
  }
  for (const ds of Object.values(datasets)) {
    ds.runs.sort((a, b) => a.pid.localeCompare(b.pid) || a.runDir.localeCompare(b.runDir) || a.run - b.run);
    const counters = {};
    for (const r of ds.runs) { counters[r.pid] = (counters[r.pid] || 0) + 1; r.run = counters[r.pid]; }
  }

  const data = { problems: PROBLEMS, datasets, generated: new Date().toISOString() };
  const dataJs = `// Auto-generated by experiments/viewer/build-data.mjs\nwindow.RUN_DATA = ${JSON.stringify(data, null, 2)};`;
  writeFileSync(OUT, dataJs);

  // Also patch index.html to inline the data so file:// works in Chrome
  const htmlPath = join(__dirname, 'index.html');
  let html = readFileSync(htmlPath, 'utf8');
  html = html.replace(/<script>\s*\/\/ --- inline data ---[\s\S]*?<\/script>/, '');
  html = html.replace('<script>', `<script>\n// --- inline data ---\n${dataJs}\n</script>\n<script>`);
  writeFileSync(htmlPath, html);

  const total = allRuns.length;
  const keys = Object.keys(datasets).join(', ');
  console.log(`✓ data.js: ${total} runs, ${Object.keys(datasets).length} datasets [${keys}]`);
  console.log(`  Open: ${join(__dirname, 'index.html')}`);
}

buildData();
