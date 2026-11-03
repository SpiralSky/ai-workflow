import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {readBounded,inventory} from './files.mjs';
import {digest} from './protocol.mjs';

const PUBLIC_SCOPE=['packages','scripts/native-interactive','scripts/native-comparison','package.json','package-lock.json','experiments/native-dev/manifest.json'];
const PRIVATE_GATE_INPUTS=Object.freeze([
 '.specplane/native-reconstruction-inventory.json',
 '.specplane/native-offline-check-inventory.json',
 'docs/dot-progress/native-interactive-reconstruction.md',
 'docs/dot-progress/native-hotpath-extension-plan.md',
 'docs/dot-progress/native-action-receipt-proposal.md',
 'docs/dot-progress/native-offline-check-adaptation.md',
 'experiments/native-dev/grade.py',
]);
/** Canonical public fixture paths come only from the fixed public manifest. */
function relative(value){if(typeof value!=='string'||!value||value.includes('\\')||value.includes('\0')||path.isAbsolute(value)||value.split('/').some(p=>!p||p==='.'||p==='..'))throw Error('invalid public fixture path');return value;}
/** Read-only public preparation evidence, deliberately not an admission or grading shortcut.
 * Never reads private gate inputs, the private bundle, or the optional hotpath checkout.
 * A source/fixture snapshot does not verify installed dependencies or native tool-log coverage.
 * Uses existing quiescent filesystem readers, not a hostile-race or directory-allocation sandbox.
 */
export function inspectPublicAdmissionInputs(root=path.resolve(import.meta.dirname,'../..')){
 root=path.resolve(root);
 if(fs.realpathSync(root)!==root)throw Error('noncanonical public input root');
 const git=(...args)=>execFileSync('git',['--no-optional-locks','-C',root,...args],{encoding:'utf8',timeout:10000,maxBuffer:4194304,env:{PATH:process.env.PATH,GIT_TERMINAL_PROMPT:'0'}});
 if(git('rev-parse','--show-toplevel').trim()!==root)throw Error('public input root must be repository root');
 const commit=git('rev-parse','HEAD').trim(),tree=git('rev-parse','HEAD^{tree}').trim();
 if(!/^[a-f0-9]{40}$/.test(commit)||!/^[a-f0-9]{40}$/.test(tree))throw Error('invalid public source identity');
 const manifestFile=path.join(root,'experiments/native-dev/manifest.json'),manifestBytes=readBounded(manifestFile,65536),manifest=JSON.parse(manifestBytes);
 if(manifest.version!==1||manifest.status!=='draft'||manifest.canonicalCampaign!==false||!Array.isArray(manifest.fixtures)||!manifest.fixtures.length||manifest.fixtures.length>100)throw Error('invalid public fixture manifest');
 const seen=new Set(),fixturePaths=[],fixtureScopes=[],fixtures=[];
 for(const fixture of manifest.fixtures){
  if(!/^[a-z0-9-]+$/.test(fixture.id)||seen.has(fixture.id))throw Error('invalid public fixture id');seen.add(fixture.id);
  const prefix='experiments/native-dev/'+fixture.id+'/',task=relative(fixture.taskPath),workspace=relative(fixture.workspaceDir);
  if(task!==prefix+'TASK.md'||workspace!==prefix+'workspace'||!Array.isArray(fixture.allowedWritePaths)||!fixture.allowedWritePaths.length)throw Error('invalid public fixture layout');
  const allowed=fixture.allowedWritePaths.map(relative);if(new Set(allowed).size!==allowed.length)throw Error('duplicate public write path');
  relative(fixture.publicTestTarget);
  const entries=inventory(path.join(root,workspace));
  if(Object.getPrototypeOf(entries)!==Object.prototype)throw Error('unsupported public fixture property name');
  if(!Object.keys(entries).length)throw Error('empty public fixture workspace');
  fixturePaths.push(task,...Object.keys(entries).map(p=>workspace+'/'+p));
  fixtureScopes.push(task,workspace);
  fixtures.push({id:fixture.id,taskPath:task,workspaceDir:workspace,allowedWritePaths:allowed,publicTestTarget:fixture.publicTestTarget,workspace:entries});
 }
 const rows=git('ls-tree','-r','-z','HEAD','--',...PUBLIC_SCOPE,...fixtureScopes).split('\0').filter(Boolean);
 if(!rows.length||rows.length>2000)throw Error('public source inventory bound');
 const sources={};let total=0;
 for(const row of rows){
  const match=/^(100644|100755) blob ([a-f0-9]{40})\t(.+)$/.exec(row);if(!match)throw Error('unsupported public source entry');
  const [,mode,oid,rel]=match;relative(rel);
  if(PRIVATE_GATE_INPUTS.includes(rel))throw Error('private gate input selected for public preflight');
  const file=path.join(root,rel),bytes=readBounded(file,8388608);if((total+=bytes.length)>134217728)throw Error('public source byte bound');
  const observed=createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
  if(observed!==oid||((fs.statSync(file).mode&0o111)?'100755':'100644')!==mode)throw Error('public working bytes/mode changed');
  sources[rel]={sha256:digest(bytes),bytes:bytes.length,mode};
 }
 for(const required of ['package.json','package-lock.json','experiments/native-dev/manifest.json',...fixturePaths])if(!sources[required])throw Error('public fixture input is not committed');
 if(!Object.keys(sources).some(p=>p.startsWith('packages/')))throw Error('missing public runtime sources');
 if(sources['experiments/native-dev/manifest.json'].sha256!==digest(manifestBytes))throw Error('public manifest changed during observation');
 for(const fixture of fixtures)for(const [rel,entry]of Object.entries(fixture.workspace))if(sources[fixture.workspaceDir+'/'+rel].sha256!==entry.sha256)throw Error('public fixture changed during observation');
 if(git('rev-parse','HEAD').trim()!==commit)throw Error('public source changed during observation');
 return {version:'public-admission-inputs-v1',status:'public-inputs-verified',commit,tree,sourceIdentitySHA256:digest(sources),sourceFiles:Object.keys(sources).length,sourceBytes:total,fixtures,sources,
  readyForActors:false,readyForGrading:false,fullAdmissionGate:'unchanged; required before any campaign',privateMaterialPresence:'not assessed',nativeToolLogCoverage:'not assessed',installedRuntimeClosure:'not assessed',untrackedRuntimeFiles:'not assessed',overallCheckoutCleanliness:'not assessed',
  limitations:['Read-only preparation evidence, not campaign admission or task success','Private gate inputs and hotpath runtime are not read or validated','Same-account native comparisons are screening only','Full grading still requires a permitted boundary outside candidate reach']};
}

if(process.argv[1]&&pathToFileURL(path.resolve(process.argv[1])).href===import.meta.url){
 try{if(process.argv.length>3)throw Error('unexpected arguments');const result=inspectPublicAdmissionInputs(process.argv[2]);const {sources,fixtures,...summary}=result;console.log(JSON.stringify({...summary,fixtureIds:fixtures.map(f=>f.id)},null,2));}
 catch{console.error('public admission input verification failed; no admission or actor run performed');process.exitCode=1;}
}
