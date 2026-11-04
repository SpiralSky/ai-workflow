/** Self-contained preservation inventories; historical Git objects provide additional verification only. */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

export const RUNTIME_SCOPE = ['packages','framework','experiments','.claude','.claude-plugin','package.json','package-lock.json','tsconfig.json','tsconfig.base.json'];
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const git = (root,...args) => execFileSync('git',args,{cwd:root, maxBuffer:64*1024*1024});

/** Reject unsafe/duplicate paths and unsupported entries rather than weakening preservation checks. */
export function validateInventory(inventory) {
  assert.equal(inventory.version,1);
  assert.match(inventory.source_ref,/^[a-f0-9]{40}$/);
  assert.ok(Array.isArray(inventory.files) && inventory.files.length > 0);
  const paths = [];
  for (const entry of inventory.files) {
    assert.ok(typeof entry.path === 'string' && entry.path.length > 0 && !path.posix.isAbsolute(entry.path));
    assert.ok(!entry.path.split('/').some(p => p === '..' || p === '.' || !p));
    assert.ok(!entry.path.includes('\\'));
    assert.ok(['100644','100755','120000'].includes(entry.mode), `Unsupported mode: ${entry.path}`);
    assert.match(entry.sha256,/^[a-f0-9]{64}$/);
    paths.push(entry.path);
  }
  assert.equal(new Set(paths).size,paths.length,'Duplicate inventory path');
  return paths.sort();
}

/** Include index modes/stages: staged additions, removals and unresolved merges cannot disappear. */
export function trackedEntries(root, scope) {
  return git(root,'ls-files','--stage','-z','--',...scope).toString('utf8').split('\0').filter(Boolean).map(row => {
    const tab = row.indexOf('\t');
    const [mode,,stage] = row.slice(0,tab).split(' ');
    assert.equal(stage,'0','Unmerged index entries are not a preserved snapshot');
    return {path:row.slice(tab+1),mode};
  }).sort((a,b)=>a.path.localeCompare(b.path,'en'));
}

/** Git hashes symlinks by target text; normal files are checked by bytes and executable mode. */
export function workingEntry(root, file) {
  const full = path.join(root,file);
  const stat = fs.lstatSync(full);
  assert.ok(stat.isFile() || stat.isSymbolicLink(),`Not a file/symlink: ${file}`);
  const mode = stat.isSymbolicLink() ? '120000' : (stat.mode & 0o111) ? '100755' : '100644';
  const bytes = stat.isSymbolicLink() ? fs.readlinkSync(full,{encoding:'buffer'}) : fs.readFileSync(full);
  return {path:file,mode,sha256:sha256(bytes)};
}

/** Compare the complete tracked scope and actual worktree content, including unstaged modifications. */
export function verifyWorkingInventory(root, inventory, replacements = {}) {
  const expected = validateInventory(inventory);
  const tracked = trackedEntries(root,inventory.scope ?? expected);
  assert.deepEqual(tracked.map(e=>e.path).sort(),expected,'Tracked inventory contains added or missing paths');
  const indexed = new Map(tracked.map(e=>[e.path,e.mode]));
  for (const entry of inventory.files) {
    const expectedHash = replacements[entry.path] ?? entry.sha256;
    assert.equal(indexed.get(entry.path),entry.mode,`Tracked mode changed: ${entry.path}`);
    const actual = workingEntry(root,entry.path);
    assert.equal(actual.mode,entry.mode,`Working mode changed: ${entry.path}`);
    assert.equal(actual.sha256,expectedHash,`Preserved content changed: ${entry.path}`);
  }
}

/** Bind a reviewed follow-on patch to existing inventory bytes without rewriting the baseline. */
export function runtimeAllowanceHashes(inventory, allowance) {
  assert.equal(allowance.version, 1);
  assert.match(allowance.base_ref, /^[a-f0-9]{40}$/);
  assert.ok(typeof allowance.reason === 'string' && allowance.reason.trim());
  assert.ok(Array.isArray(allowance.changes) && allowance.changes.length > 0);
  validateInventory({ version: 1, source_ref: allowance.base_ref,
    files: allowance.changes.map(e => ({path: e.path, mode: e.mode, sha256: e.after_sha256})) });
  const originals = new Map(inventory.files.map(e => [e.path, e]));
  const hashes = {};
  for (const change of allowance.changes) {
    const original = originals.get(change.path);
    assert.ok(original, `Allowance cannot add a runtime path: ${change.path}`);
    assert.notEqual(change.path, 'packages/viewer/package.json', 'Viewer test allowance remains separate');
    assert.equal(change.mode, original.mode, `Allowance cannot change mode: ${change.path}`);
    assert.equal(change.before_sha256, original.sha256, `Allowance before hash differs from inventory: ${change.path}`);
    assert.notEqual(change.after_sha256, change.before_sha256, `Redundant runtime allowance: ${change.path}`);
    hashes[change.path] = change.after_sha256;
  }
  return hashes;
}

/** Verify inventory provenance against history if available; missing objects never skip worktree checks. */
export function verifyHistoricalInventory(root, inventory) {
  validateInventory(inventory);
  const query = `${inventory.source_ref}^{commit}`;
  const result = execFileSync('git',['cat-file','--batch-check'],{cwd:root,input:query+'\n',encoding:'utf8'}).trim();
  if (result === `${query} missing`) return 'unavailable; verified self-contained inventory';
  assert.match(result,/^[a-f0-9]{40} commit \d+$/,'Historical reference did not resolve to a commit');
  const rows = git(root,'ls-tree','-rz',inventory.source_ref,'--',...(inventory.scope ?? inventory.files.map(e=>e.path))).toString('utf8').split('\0').filter(Boolean).map(row => {
    const tab = row.indexOf('\t'); const [mode,type,oid] = row.slice(0,tab).split(' ');
    assert.equal(type,'blob');
    return {path:row.slice(tab+1),mode,sha256:sha256(git(root,'cat-file','blob',oid))};
  });
  const sorted = entries => [...entries].sort((a,b)=>a.path.localeCompare(b.path,'en'));
  assert.deepEqual(sorted(rows),sorted(inventory.files),'Recorded source inventory differs from available historical objects');
  return 'verified historical objects and self-contained inventory';
}
