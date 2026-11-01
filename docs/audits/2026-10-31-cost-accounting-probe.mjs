/** Diagnostic of cost reporting plus repaired provenance rejection, not a cost acceptance test.
 * Run: node docs/audits/2026-10-31-cost-accounting-probe.mjs
 * Fixtures use synthetic dollar values; no API calls or benchmark tasks are executed.
 */
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { combineRuns } from '../../packages/runner/src/combine.ts';
const root = mkdtempSync(join(tmpdir(), 'aiw-accounting-audit-'));
const config = { tier:'S', models:{main:'fixture',secondary:'fixture'}, temperature:0,
 secondaryCap:4, branch:{context:'trace'}, frameworks:['orchestrate'] };
const makeRun = (id, commit, jobs) => {
 const dir = join(root,id); mkdirSync(dir);
 writeFileSync(join(dir,'run.json'), JSON.stringify({format:1,id,status:'complete',config,
  provenance:{commit,dirty:false,runnerVersion:'fixture',engine:'fixture',basePrompt:commit,frameworks:{},images:{},problems:{}}}));
 for (const [i,job] of jobs.entries()) {
  const j = join(dir,`job-${i}`); mkdirSync(j);
  writeFileSync(join(j,'job.json'),JSON.stringify({format:1,problem:'fixture',framework:'orchestrate',rep:i,
   reason:null,attempts:[{n:0,final:true}],durationMs:0,...job}));
 }
 return dir;
};
const a = makeRun('a','commit-a',[{outcome:'pass',costUsdAllAttempts:1},{outcome:'fail',costUsdAllAttempts:3}]);
await combineRuns([a],'cost-denominator',root);
const result = JSON.parse(readFileSync(join(root,'experiments/reports/cost-denominator/report.json'),'utf8'));
assert.equal(result.frameworks.orchestrate.costPerSuccessUsd,1);
assert.equal(result.frameworks.orchestrate.meanCostUsd,2);
const b = makeRun('b','commit-b',[{outcome:'pass',costUsdAllAttempts:2}]);
await assert.rejects(combineRuns([a,b],'mixed-provenance',root), /provenance\.commit/);
console.log(JSON.stringify({synthetic:true, measuredModelCost:false,
 costPerSuccessReported:1, totalSpendPerSuccess:4,
 mixedCommitRunsRejected:true,
 scratchOutput:root},null,2));
