import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
const oid = value => typeof value === 'string' && /^[a-f0-9]{40,64}$/.test(value);
/** Run bounded read-only Git commands, without refreshing/writing the index or exposing stderr. */
function git(root, args) {
  const result = spawnSync('git', ['--no-optional-locks', '-C', root, ...args], {encoding:'utf8', timeout:10000, maxBuffer:4*1024*1024, env:{...process.env, GIT_TERMINAL_PROMPT:'0'}});
  if (result.error || result.status !== 0) throw new Error('Git observation unavailable');
  return result.stdout.trimEnd();
}
/** Observe process identity only; never read command lines, environments or private sessions. */
export function processIdentity(pid, procRoot='/proc') {
  if (!Number.isSafeInteger(pid) || pid < 1) throw new Error('Invalid PID');
  try {
    const stat = fs.readFileSync(path.join(procRoot, String(pid), 'stat'), 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).trim().split(/\s+/);
    const boot = fs.readFileSync(path.join(procRoot, 'sys/kernel/random/boot_id'), 'utf8').trim();
    if (!boot || !/^\d+$/.test(fields[19] ?? '')) throw new Error('Invalid process observation');
    return {pid, boot, startTicks:fields[19], state:fields[0]};
  } catch { return {pid, unavailable:true}; }
}
/** Capture a caller-owned checkpoint. Returns data only; publication/storage is a separate authorized action. */
export function capture(root, repositoryId, pids=[]) {
  if (typeof repositoryId !== 'string' || !repositoryId.trim()) throw new Error('repositoryId required');
  root = fs.realpathSync(root);
  if (fs.realpathSync(git(root,['rev-parse','--show-toplevel'])) !== root) throw new Error('Root must be repository top level');
  const worktrees = git(root,['worktree','list','--porcelain','-z']).split('\0\0').filter(Boolean).map(block => {
    const lines = block.split('\0');
    return {root:lines.find(x=>x.startsWith('worktree '))?.slice(9), head:lines.find(x=>x.startsWith('HEAD '))?.slice(5), branch:lines.find(x=>x.startsWith('branch '))?.slice(7) ?? null};
  });
  const branch = git(root,['rev-parse','--symbolic-full-name','HEAD']);
  const dirty = git(root,['status','--porcelain=v1','--untracked-files=all']);
  return {version:1, repositoryId, root, head:git(root,['rev-parse','HEAD']), tree:git(root,['rev-parse','HEAD^{tree}']), branch:branch==='HEAD'?null:branch, dirty:!!dirty, statusDigest:hash(dirty), worktrees, processes:pids.map(pid=>processIdentity(pid)), capturedAt:new Date().toISOString(), limitations:['Local checkpoint can roll back with workspace','Dirty file contents are not backed up','Process presence is not progress or success']};
}
/** Compare an independently retained expectation. Never reset, checkout, fetch, kill or retry work. */
export function inspect(checkpoint, {remote=false, observeProcess=processIdentity}={}) {
  if (checkpoint?.version !== 1 || !path.isAbsolute(checkpoint.root ?? '') || !oid(checkpoint.head) || !oid(checkpoint.tree) || typeof checkpoint.statusDigest !== 'string' || !Array.isArray(checkpoint.worktrees) || !Array.isArray(checkpoint.processes)) throw new Error('Invalid checkpoint');
  const findings = [];
  const add = (kind, detail) => findings.push({kind, detail});
  let current;
  try { current = capture(checkpoint.root, checkpoint.repositoryId); }
  catch { add('workspace-unavailable','Expected repository root cannot be observed; no recovery action taken'); }
  if (current) {
    if (current.head !== checkpoint.head) add('head-mismatch',{expected:checkpoint.head, observed:current.head});
    if (current.tree !== checkpoint.tree) add('tree-mismatch',{expected:checkpoint.tree, observed:current.tree});
    if (current.branch !== checkpoint.branch) add('branch-mismatch',{expected:checkpoint.branch, observed:current.branch});
    if (current.statusDigest !== checkpoint.statusDigest) add('working-status-changed','Paths/status changed; contents were not backed up');
    if (current.dirty || checkpoint.dirty) add('uncommitted-work','Preserve and inspect dirty work; status digest does not validate file contents');
    for (const expected of checkpoint.worktrees) {
      const observed = current.worktrees.find(x=>x.root===expected.root);
      if (!observed || !fs.existsSync(expected.root)) add('worktree-unavailable',expected.root);
      else if (observed.head !== expected.head || observed.branch !== expected.branch) add('worktree-changed',expected.root);
    }
    try { git(checkpoint.root,['cat-file','-e',`${checkpoint.head}^{commit}`]); }
    catch { add('expected-commit-unavailable','Expected commit is absent or cannot be read; publication/backup needed for recovery'); }
  }
  const localMatches = !!current && !findings.length;
  const processes = checkpoint.processes.map(expected => {
    const actual = observeProcess(expected.pid);
    let status = 'identity-unknown';
    if (!expected.unavailable && !actual.unavailable) status = expected.boot === actual.boot && expected.startTicks === actual.startTicks ? (['Z','X'].includes(actual.state) ? 'not-running-outcome-unknown' : 'present-progress-unknown') : 'different-process-or-boot';
    return {pid:expected.pid,status};
  });
  for (const process of processes) add('process-needs-reconciliation',process);
  let external = {status:'not-checked'};
  if (remote) {
    const reference = checkpoint.external;
    if (!reference || !/^refs\/heads\/[A-Za-z0-9_./-]+$/.test(reference.ref ?? '') || !oid(reference.head)) throw new Error('Explicit external ref/head required');
    try {
      const output = git(checkpoint.root,['ls-remote','--exit-code','origin',reference.ref]);
      const rows = output.split('\n').map(line=>line.split(/\s+/));
      const observed = rows.find(row=>row[1]===reference.ref)?.[0];
      external = {status:observed===reference.head ? 'matches-recorded-origin-ref' : 'remote-different', observed:oid(observed)?observed:null};
    } catch { external = {status:'unavailable'}; }
    if (external.status !== 'matches-recorded-origin-ref') add('external-checkpoint-needs-reconciliation',external.status);
  }
  return {version:1, repositoryId:checkpoint.repositoryId, checkedAt:new Date().toISOString(), safeToResumeAutomatically:false, localMatches, findings, processes, external, next:'Inspect findings and terminal logs; recover only into a new authorized worktree. Never infer lost work completed or automatically retry uncertain operations.'};
}
if (process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  try {
    const [action,input,id,...rest]=process.argv.slice(2);
    if (action==='capture') {
      if (rest.length) throw new Error('Use module API for PID observations');
      console.log(JSON.stringify(capture(input,id),null,2));
    } else if (action==='check') {
      if (rest.length || (id && id!=='--remote')) throw new Error('Unexpected arguments');
      const result=inspect(JSON.parse(fs.readFileSync(input,'utf8')),{remote:id==='--remote'});
      console.log(JSON.stringify(result,null,2)); process.exitCode=result.findings.length?2:0;
    } else throw new Error('Usage: workspace-recovery.mjs capture ROOT REPOSITORY_ID | check CHECKPOINT [--remote]');
  } catch(error) { console.error(error.message); process.exitCode=1; }
}
