import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {digest} from './protocol.mjs';
import {inventory} from './files.mjs';
import {publicCanaryRegistry,canaryRegistryBytes} from './screening-audit.mjs';
import {SCREENING_MODE,admissionMode,validateScreeningControls,inspectPrivateGrader} from './cooperative-screening.mjs';

const registry=publicCanaryRegistry({version:1,campaignId:'synthetic-controls',entries:[{artifactId:'grader',role:'grader',cellId:null,marker:'AIW_CANARY_'+'0'.repeat(32),authorizedScopes:[{role:'coordinator',phase:'grade',cellId:null}]},...['one','two'].map((cellId,i)=>({artifactId:'output-'+cellId,role:'run-output',cellId,marker:'AIW_CANARY_'+String(i+1).repeat(32),authorizedScopes:[{role:'coordinator',phase:'audit',cellId}]}))]});
const controls={version:1,canaryRegistrySHA256:digest(canaryRegistryBytes(registry)),privateAbsenceSHA256:digest('synthetic absence'),runtimeClosureSHA256:digest('synthetic closure'),auditCoverage:'relay-and-observed-native-tools-only',coordinatorTarget:'/root/synthetic_coordinator'};
/** Separate toy repositories avoid any real private sources or actor execution. Retain all evidence. */
async function setup(){
 const base=fs.mkdtempSync(path.join(os.tmpdir(),'cooperative-controls-')),root=path.join(base,'public');fs.mkdirSync(root);
 const put=(name,value)=>{const file=path.join(root,name);fs.mkdirSync(path.dirname(file),{recursive:true});fs.writeFileSync(file,value);};
 fs.cpSync(import.meta.dirname,path.join(root,'scripts/native-interactive'),{recursive:true});
 put('package.json','{"type":"module","private":true}\n');put('package-lock.json','{"lockfileVersion":3}\n');
 put('packages/tools/python/aiw_sidecar/offline_check_runtime.json','{"mode":"native-offline-bundled-pyright-v1"}\n');
 put('experiments/native-dev/example/TASK.md','Repair the toy value and add a regression test.\n');
 put('experiments/native-dev/example/workspace/app.py','value = 0\n');
 put('experiments/native-dev/manifest.json',JSON.stringify({version:1,status:'draft',canonicalCampaign:false,fixtures:[{id:'example',taskPath:'experiments/native-dev/example/TASK.md',workspaceDir:'experiments/native-dev/example/workspace',allowedWritePaths:['app.py','tests/test_regressions.py'],publicTestTarget:'tests'}]})+'\n');
 const git=(...args)=>execFileSync('git',['-C',root,...args],{encoding:'utf8',stdio:['ignore','pipe','pipe']});
 const commit=()=>{git('add','.');git('-c','user.name=Synthetic Control','-c','user.email=synthetic@example.invalid','commit','-q','-m','test: synthetic source');};
 git('init','-q');commit();
 const api=await import(pathToFileURL(path.join(root,'scripts/native-interactive/coordinator.mjs')).href);
 const campaignDir=path.join(base,'campaign');
 const freeze=(extra={})=>{api.freezeCampaign({campaignDir,cells:[{id:'one',fixtureId:'example',arm:'direct'},{id:'two',fixtureId:'example',arm:'direct'}],admissionMode:SCREENING_MODE,screeningControls:controls,...extra});fs.writeFileSync(path.join(campaignDir,'canary-registry.json'),canaryRegistryBytes(registry));};
 const admit=(index=0,extra={})=>api.admitNext({campaignDir,index,venv:'/synthetic-unused',actorId:'synthetic-actor-'+index,privateAbsenceSHA256:digest('synthetic cell absence '+index),...extra});
 const json=(cell,name)=>JSON.parse(fs.readFileSync(path.join(cell,name)));
 const write=(cell,name,value)=>fs.writeFileSync(path.join(cell,name),JSON.stringify(value)+'\n');
 const finish=(config)=>{
  fs.mkdirSync(path.join(config.root,'tests'));fs.writeFileSync(path.join(config.root,'tests/test_regressions.py'),'# Synthetic regression evidence only.\n');
  fs.mkdirSync(config.journalDir);const outcome={status:'submitted',cleanupStatus:'closed'};
  write(config.journalDir,'000001.json',{type:'terminal',outcome});
  write(config.cellDir,'supervisor-result.json',{status:'submitted',cleanup:'closed',outcome,configSHA256:digest(fs.readFileSync(path.join(config.cellDir,'config.json'))),admissionSHA256:digest(fs.readFileSync(path.join(config.cellDir,'admission.json')))});
  return api.snapshotSubmission({cellDir:config.cellDir});
 };
 const audit=(cell,extra={})=>{
  const dir=path.join(cell,'action-receipts');fs.mkdirSync(dir,{recursive:true});
  fs.writeFileSync(path.join(dir,'000001.input.jsonl'),'{"sequence":1,"kind":"submit"}\n');fs.writeFileSync(path.join(dir,'000001.feedback.jsonl'),'{"kind":"submitted"}\n');
  fs.writeFileSync(path.join(cell,'ready-frame.jsonl'),'{"kind":"ready"}\n');
  write(cell,'audit-observations.json',{version:1,nativeToolLogCoverage:'unavailable',subprocessReadCoverage:'unobserved',accessFindings:[]});
  write(cell,'audit.json',{...api.inspectCellScreeningAudit({cellDir:cell}),...extra});
 };
 const privateRoot=path.join(base,'post-solve-private');
 const makeGrader=(suffix='')=>{
  fs.cpSync(path.join(root,'experiments/native-dev'),privateRoot,{recursive:true});
  fs.writeFileSync(path.join(privateRoot,'grade.py'),`import hashlib,json,pathlib,sys\ndef fp(root):\n    return hashlib.sha256(json.dumps({str(p.relative_to(root)):hashlib.sha256(p.read_bytes()).hexdigest() for p in sorted(root.rglob('*')) if p.is_file()},sort_keys=True).encode()).hexdigest()\nroot=pathlib.Path(__file__).parent\nprint(json.dumps({'fixture':sys.argv[1],'fullTaskSuccess':None,'submittedSHA256':fp(pathlib.Path(sys.argv[2])),'fixtureSHA256':fp(root/sys.argv[1]),'status':'review_required','executableChecksPassed':True}))\n`+suffix);
  return inspectPrivateGrader(privateRoot,root).sha256;
 };
 return {base,root,put,git,commit,api,campaignDir,freeze,admit,json,write,finish,audit,makeGrader,privateRoot};
}

test('mode and controls fail closed; missing mode retains full admission',()=>{
 assert.equal(admissionMode(),'full');assert.equal(admissionMode(SCREENING_MODE),SCREENING_MODE);
 assert.throws(()=>admissionMode('screening'));assert.deepEqual(validateScreeningControls(controls),controls);
 for(const value of [undefined,{...controls,extra:true},{...controls,coordinatorTarget:'/root/../other'},{...controls,canaryRegistrySHA256:'marker literal'},{...controls,auditCoverage:'complete'}])assert.throws(()=>validateScreeningControls(value));
});
test('default full gate still fails when its private sources are unavailable; no cell is created',async()=>{
 const f=await setup(),cellDir=path.join(f.base,'default');
 assert.throws(()=>f.api.prepareCell({cellDir,fixtureId:'example',arm:'direct',venv:'/unused'}),/ENOENT/);
 assert.equal(fs.existsSync(cellDir),false);
 assert.throws(()=>f.freeze({admissionMode:'full'}),/ENOENT/);
 assert.equal(fs.existsSync(f.campaignDir),false);
});
test('explicit direct and expanded screening verify committed public sources without private or hotpath reads',async()=>{
 const f=await setup();f.freeze({cells:[{id:'one',fixtureId:'example',arm:'direct'},{id:'two',fixtureId:'example',arm:'branch-expanded'}]});
 const c=f.admit(),a=f.json(c.cellDir,'admission.json');
 assert.equal(a.admissionMode,SCREENING_MODE);assert.equal(a.candidateBinding,null);assert.equal(a.evidenceMode,'synthetic-control');
 assert.equal(a.publicSourceIdentity.commit,f.git('rev-parse','HEAD').trim());
 assert.equal(typeof a.bindings['scripts/native-interactive/protocol.mjs'],'string');
 assert.deepEqual(a.selectedArms,['branch-expanded','direct']);assert.ok(a.limitations.some(v=>v.includes('not proof')));
 assert.equal(fs.existsSync(path.join(f.root,'experiments/native-dev/grade.py')),false);
 assert.throws(()=>f.admit(1),/ENOENT/);
});
test('a selected hotpath arm still requires its original pinned runtime',async()=>{
 const f=await setup();assert.throws(()=>f.freeze({cells:[{id:'one',fixtureId:'example',arm:'direct'},{id:'two',fixtureId:'example',arm:'branch-hotpath2'}]}),/ENOENT/);
 assert.equal(fs.existsSync(f.campaignDir),false);
});
test('screening requires explicit per-cell private absence evidence and frozen control commitments',async()=>{
 const f=await setup();f.freeze();assert.throws(()=>f.admit(0,{privateAbsenceSHA256:undefined}),/absence/);
 assert.equal(fs.existsSync(path.join(f.campaignDir,'one')),false);
 const g=await setup();assert.throws(()=>g.freeze({screeningControls:undefined}),/controls/);
});
test('working byte changes and same-tree new commit identity invalidate frozen admission',async()=>{
 const f=await setup();f.freeze();f.put('experiments/native-dev/example/workspace/app.py','changed\n');assert.throws(()=>f.admit(),/working bytes/);
 const g=await setup();g.freeze();g.git('-c','user.name=Synthetic Control','-c','user.email=synthetic@example.invalid','commit','--allow-empty','-q','-m','test: different commit');assert.throws(()=>g.admit(),/identity/);
});
test('native screening still rejects synthetic-only supervisor receipts',async()=>{
 const f=await setup();f.freeze({evidenceMode:'native-assignment'});const c=f.admit();assert.throws(()=>f.finish(c),/ENOENT|runtime/);assert.equal(fs.existsSync(path.join(c.cellDir,'submission-result.json')),false);
});
test('post-solve grading requires explicit audit and exact separate private identity',async()=>{
 const f=await setup();f.freeze();const c=f.admit();f.finish(c);const expectedPrivateSHA256=f.makeGrader();
 assert.throws(()=>f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256}),/ENOENT/);
 f.audit(c.cellDir,{comparisonEligible:false});assert.throws(()=>f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256}),/audit/);
 f.audit(c.cellDir);assert.throws(()=>f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256:digest('wrong')}),/commitment/);
 const result=f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256});assert.equal(result.executableChecksPassed,true);assert.equal(result.fullTaskSuccess,null);
 assert.throws(()=>f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256}),/EEXIST/);
 const review=f.api.recordReview({cellDir:c.cellDir,reviewerId:'synthetic-independent',meaningful:true,evidence:'Synthetic control only: explicit fake grader and dummy regression demonstrate lineage, not a real fixture result.'});
 assert.equal(review.fullTaskSuccess,true);assert.equal(review.admissionMode,SCREENING_MODE);assert.ok(review.auditSHA256);
 assert.throws(()=>f.admit(1),/ENOENT/);
 const raw=fs.readFileSync(path.join(c.cellDir,'grade-output.json'));f.api.recordGradingOutputCheckpoint({cellDir:c.cellDir,libraryFileId:'synthetic-not-a-real-backup',versionId:'synthetic-version',observedSHA256:digest(raw)});
 assert.throws(()=>f.admit(1),/still present/);
 fs.renameSync(path.join(c.cellDir,'grade-output.json'),path.join(f.base,'retained-synthetic-output.json'));
 assert.equal(f.admit(1).arm,'direct');
});
test('private grading inputs must preserve public starting fixtures and cannot alias the public checkout',async()=>{
 const f=await setup();f.freeze();const c=f.admit();f.finish(c);f.audit(c.cellDir);f.makeGrader();
 fs.writeFileSync(path.join(f.privateRoot,'example/workspace/app.py'),'wrong initial source\n');
 const expectedPrivateSHA256=inspectPrivateGrader(f.privateRoot,f.root).sha256;
 assert.throws(()=>f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256}),/public fixture/);
 assert.throws(()=>inspectPrivateGrader(f.root,f.root),/external/);
 const alias=f.privateRoot+'-alias';fs.symlinkSync(f.privateRoot,alias);assert.throws(()=>inspectPrivateGrader(alias,f.root),/canonical/);
});
test('external public workspace extras and mode changes fail the exact fixture inventory',async()=>{
 for(const mutate of [root=>fs.writeFileSync(path.join(root,'example/workspace/extra.py'),'synthetic extra\n'),root=>fs.chmodSync(path.join(root,'example/workspace/app.py'),0o755)]){
  const f=await setup();f.freeze();const c=f.admit();f.finish(c);f.audit(c.cellDir);f.makeGrader();mutate(f.privateRoot);
  assert.throws(()=>f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256:inspectPrivateGrader(f.privateRoot,f.root).sha256}),/inventory mismatch/);
 }
});
test('cell evidence mode and campaign selected arms cannot change under frozen lineage',async()=>{
 const f=await setup();f.freeze();const c=f.admit(),admission=f.json(c.cellDir,'admission.json');admission.evidenceMode='native-assignment';f.write(c.cellDir,'admission.json',admission);
 assert.throws(()=>f.finish(c),/cell admission/);
 const g=await setup();g.freeze();const campaign=g.json(g.campaignDir,'campaign.json');campaign.selectedArms=['branch-expanded','direct'];g.write(g.campaignDir,'campaign.json',campaign);assert.throws(()=>g.admit(),/selected arms/);
});
test('grading input mutation is retained as a failed single attempt, not reusable success',async()=>{
 const f=await setup();f.freeze();const c=f.admit();f.finish(c);f.audit(c.cellDir);const expectedPrivateSHA256=f.makeGrader("(root/'changed.txt').write_text('synthetic mutation')\n");
 assert.throws(()=>f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256}),/mutated/);
 assert.ok(fs.existsSync(path.join(c.cellDir,'grade-attempt.json')));assert.equal(fs.existsSync(path.join(c.cellDir,'grade.json')),false);assert.throws(()=>f.admit(1),/ENOENT/);
});
test('contamination and observed unauthorized access prevent grading',async()=>{
 for(const extra of [{hits:[{classification:'unauthorized'}]},{hits:[{classification:'unresolved'}]},{accessFindings:[{kind:'outside-workspace-attempt'}]}]){
  const f=await setup();f.freeze();const c=f.admit();f.finish(c);f.audit(c.cellDir,extra);const expectedPrivateSHA256=f.makeGrader();
  assert.throws(()=>f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256}),/audit/);assert.equal(fs.existsSync(path.join(c.cellDir,'grade-attempt.json')),false);
 }
});

// Independent adversarial controls use only toy committed sources and synthetic graders.
test('regression: extra external public workspace file is rejected before grade attempt',async()=>{
 const f=await setup();f.freeze();const c=f.admit();f.finish(c);f.audit(c.cellDir);f.makeGrader();
 fs.writeFileSync(path.join(f.privateRoot,'example/workspace/injected.py'),'# unrelated starting fixture file\n');
 const expectedPrivateSHA256=inspectPrivateGrader(f.privateRoot,f.root).sha256;
 assert.throws(()=>f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256}),/public fixture/);
});
test('regression: removed external public task/workspace files reject before attempt',async()=>{
 for(const rel of ['example/TASK.md','example/workspace/app.py']){
  const f=await setup();f.freeze();const c=f.admit();f.finish(c);f.audit(c.cellDir);f.makeGrader();fs.renameSync(path.join(f.privateRoot,rel),path.join(f.base,'retained-'+path.basename(rel)));
  const expectedPrivateSHA256=inspectPrivateGrader(f.privateRoot,f.root).sha256;
  assert.throws(()=>f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256}),/ENOENT|public fixture/);
  assert.equal(fs.existsSync(path.join(c.cellDir,'grade-attempt.json')),false);
 }
});
test('regression: prior grade-attempt tampering blocks next admission',async()=>{
 const f=await setup();f.freeze();const c=f.admit();f.finish(c);f.audit(c.cellDir);const expectedPrivateSHA256=f.makeGrader();
 f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256});f.api.recordReview({cellDir:c.cellDir,reviewerId:'independent-synthetic',meaningful:true,evidence:'Synthetic control of grade-attempt tampering after an independent review, not actual task correctness.'});
 const file=path.join(c.cellDir,'grade-attempt.json');fs.appendFileSync(file,' ');
 assert.throws(()=>f.admit(1),/attempt changed/);assert.equal(fs.existsSync(path.join(f.campaignDir,'two')),false);
});
test('regression: mismatched campaign selectedArms rejected before first assignment',async()=>{
 const f=await setup();f.freeze();const campaign=f.json(f.campaignDir,'campaign.json');campaign.cells[1].arm='branch-hotpath2';f.write(f.campaignDir,'campaign.json',campaign);
 assert.throws(()=>f.admit(0),/arm|candidate|runtime/);
});
test('regression: unknown or missing screening mode does not fallback to screening',async()=>{
 for(const mode of ['unknown',null,undefined]){
  const f=await setup();f.freeze();const campaign=f.json(f.campaignDir,'campaign.json');campaign.admissionMode=mode;f.write(f.campaignDir,'campaign.json',campaign);
  assert.throws(()=>f.admit(0));assert.equal(fs.existsSync(path.join(f.campaignDir,'one')),false);
 }
});
test('regression: grade-attempt input substitution after grade is rejected by review',async()=>{
 const f=await setup();f.freeze();const c=f.admit();f.finish(c);f.audit(c.cellDir);const expectedPrivateSHA256=f.makeGrader();
 f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256});
 const root2=path.join(f.base,'replacement-private');fs.cpSync(f.privateRoot,root2,{recursive:true});fs.appendFileSync(path.join(root2,'grade.py'),'# different grader not executed\n');
 const attempt=f.json(c.cellDir,'grade-attempt.json');attempt.privateGrader=inspectPrivateGrader(root2,f.root);f.write(c.cellDir,'grade-attempt.json',attempt);
 assert.throws(()=>f.api.recordReview({cellDir:c.cellDir,reviewerId:'independent-synthetic',meaningful:true,evidence:'Synthetic test should detect that the recorded grader was replaced after grading and was never executed.'}),/lineage|attempt/);
});
/** Fake only ready bytes for file-layer tests; never spawn supervisor or actor. */
function publicReady(f,c){
 const task=fs.readFileSync(path.join(c.cellDir,'TASK.md'),'utf8');
 const frame=Buffer.from(JSON.stringify({kind:'ready',packet:{task,allowedWritePaths:c.allowedWritePaths,tools:[],instructions:'Synthetic file-only test.',fingerprint:{}}})+'\n');
 fs.writeFileSync(path.join(c.cellDir,'ready-frame.jsonl'),frame);
 f.write(c.cellDir,'supervisor-ready.json',{readyFraming:'utf8-json-line-including-lf',readySHA256:digest(frame),readyFrameBytes:frame.length,assignmentSHA256:digest(fs.readFileSync(path.join(c.cellDir,'assignment.json'))),admissionSHA256:digest(fs.readFileSync(path.join(c.cellDir,'admission.json'))),configSHA256:digest(fs.readFileSync(path.join(c.cellDir,'config.json')))});
}
test('regression: screening public handoff uses frozen coordinator target',async()=>{
 const f=await setup();f.freeze({evidenceMode:'native-assignment'});const c=f.admit();publicReady(f,c);
 const handoff=f.api.preparePublicHandoff({cellDir:c.cellDir});assert.ok(handoff.bootstrapInstruction.startsWith('Coordinator: /root/synthetic_coordinator.'));
 assert.ok(!handoff.bootstrapInstruction.includes('/root/restore_development_branch'));
});
test('regression: native handoff refuses cell-only mode, identity or coordinator changes',async()=>{
 for(const change of [a=>a.admissionMode='full',a=>a.evidenceMode='synthetic-control',a=>a.publicSourceIdentity.commit='a'.repeat(40),a=>a.screeningControls.coordinatorTarget='/root/elsewhere']){
  const f=await setup();f.freeze({evidenceMode:'native-assignment'});const c=f.admit(),admission=f.json(c.cellDir,'admission.json');change(admission);f.write(c.cellDir,'admission.json',admission);publicReady(f,c);
  assert.throws(()=>f.api.preparePublicHandoff({cellDir:c.cellDir}));assert.equal(fs.existsSync(path.join(c.cellDir,'public-handoff.txt')),false);
 }
});
test('regression: removing per-cell private absence evidence blocks native handoff',async()=>{
 const f=await setup();f.freeze({evidenceMode:'native-assignment'});const c=f.admit(),admission=f.json(c.cellDir,'admission.json');delete admission.privateAbsenceSHA256;f.write(c.cellDir,'admission.json',admission);publicReady(f,c);
 assert.throws(()=>f.api.preparePublicHandoff({cellDir:c.cellDir}),/absence/);
});
test('regression: grading subprocess cannot rewrite grade-attempt before provenance capture',async()=>{
 const f=await setup();f.freeze();const c=f.admit();f.finish(c);f.audit(c.cellDir);
 const expectedPrivateSHA256=f.makeGrader("(pathlib.Path(sys.argv[2]).parent/'grade-attempt.json').open('a').write(' ')\n");
 assert.throws(()=>f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256}),/attempt|mutat/);
 assert.equal(fs.existsSync(path.join(c.cellDir,'grade.json')),false);
});
test('regression: review rejects grade field change while retaining raw-output hash',async()=>{
 const f=await setup();f.freeze();const c=f.admit();f.finish(c);f.audit(c.cellDir);f.makeGrader();
 const script=path.join(f.privateRoot,'grade.py');fs.writeFileSync(script,fs.readFileSync(script,'utf8').replace("'executableChecksPassed':True","'executableChecksPassed':False"));
 const expectedPrivateSHA256=inspectPrivateGrader(f.privateRoot,f.root).sha256;
 f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256});
 const grade=f.json(c.cellDir,'grade.json');assert.equal(grade.executableChecksPassed,false);grade.executableChecksPassed=true;f.write(c.cellDir,'grade.json',grade);
 assert.throws(()=>f.api.recordReview({cellDir:c.cellDir,reviewerId:'independent-synthetic',meaningful:true,evidence:'Synthetic test must not convert failed grader output into success by rewriting one grade JSON field.'}),/output|grade|lineage/);
});

// Independently reproduced final integration regressions.
test('public summary strips arbitrary private grader fields while preserving raw evidence',async()=>{
 const f=await setup();f.freeze();const c=f.admit();f.finish(c);f.audit(c.cellDir);f.makeGrader();
 const p=path.join(f.privateRoot,'grade.py');fs.writeFileSync(p,fs.readFileSync(p,'utf8').replace("'executableChecksPassed':True", "'executableChecksPassed':True,'hiddenCaseText':'PRIVATE_SYNTHETIC_HIDDEN_RESULT','cooperativeProvenance':{'secret':'PRIVATE_SYNTHETIC_HIDDEN_RESULT'}"));
 const expectedPrivateSHA256=inspectPrivateGrader(f.privateRoot,f.root).sha256;
 const grade=f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256});
 assert.equal(JSON.stringify(grade).includes('PRIVATE_SYNTHETIC_HIDDEN_RESULT'),false);
 assert.equal(fs.readFileSync(path.join(c.cellDir,'grade-output.json'),'utf8').includes('PRIVATE_SYNTHETIC_HIDDEN_RESULT'),true);
 const review=f.api.recordReview({cellDir:c.cellDir,reviewerId:'independent-synthetic',meaningful:true,evidence:'Synthetic review checks public outcome whitelisting while exact private output remains retained for evidence.'});assert.equal(review.fullTaskSuccess,true);
});
test('audit revalidation catches actual retained solver marker and cannot accept original report',async()=>{
 const f=await setup();f.freeze();const c=f.admit();f.finish(c);f.audit(c.cellDir);
 fs.appendFileSync(path.join(c.cellDir,'action-receipts/000001.input.jsonl'),'AIW_CANARY_'+'0'.repeat(32));
 const recomputed=f.api.inspectCellScreeningAudit({cellDir:c.cellDir});assert.equal(recomputed.comparisonEligible,false);assert.equal(recomputed.assessment,'contamination-detected');
 const expectedPrivateSHA256=f.makeGrader();assert.throws(()=>f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256}),/audit/);assert.equal(fs.existsSync(path.join(c.cellDir,'grade-attempt.json')),false);
});
test('authoritative audit does not permit report-selected sources or altered registry',async()=>{
 const f=await setup();f.freeze();const c=f.admit();f.finish(c);f.audit(c.cellDir);
 const report=f.json(c.cellDir,'audit.json');report.sources=report.sources.filter(s=>s.kind!=='host-journal');f.write(c.cellDir,'audit.json',report);
 const expectedPrivateSHA256=f.makeGrader();assert.throws(()=>f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256}),/audit/);
 const changed=f.json(f.campaignDir,'canary-registry.json');changed.entries[0].authorizedScopes.push({role:'coordinator',phase:'audit',cellId:null});f.write(f.campaignDir,'canary-registry.json',changed);
 assert.throws(()=>f.api.inspectCellScreeningAudit({cellDir:c.cellDir}),/registry commitment/);
});
test('next solve needs retained checkpoint and absent raw grading output',async()=>{
 const f=await setup();f.freeze();const c=f.admit();f.finish(c);f.audit(c.cellDir);const expectedPrivateSHA256=f.makeGrader();
 f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256});f.api.recordReview({cellDir:c.cellDir,reviewerId:'independent-synthetic',meaningful:true,evidence:'Synthetic control demonstrates checkpoint gating only; no real private storage or hidden grading data exists.'});
 assert.throws(()=>f.admit(1),/ENOENT/);
 assert.throws(()=>f.api.recordGradingOutputCheckpoint({cellDir:c.cellDir,libraryFileId:'toy-private-id',versionId:'toy-version-id',observedSHA256:digest('wrong')}),/mismatch/);
 const rawPath=path.join(c.cellDir,'grade-output.json'),raw=fs.readFileSync(rawPath);
 f.api.recordGradingOutputCheckpoint({cellDir:c.cellDir,libraryFileId:'toy-private-id',versionId:'toy-version-id',observedSHA256:digest(raw)});
 assert.throws(()=>f.admit(1),/still present/);fs.renameSync(rawPath,path.join(f.base,'retained-synthetic-output.json'));assert.equal(f.admit(1).arm,'direct');
});
test('incomplete grader status remains incomplete and cannot become reviewed success',async()=>{
 const f=await setup();f.freeze();const c=f.admit();f.finish(c);f.audit(c.cellDir);f.makeGrader();
 const script=path.join(f.privateRoot,'grade.py');fs.writeFileSync(script,fs.readFileSync(script,'utf8').replace("'status':'review_required'","'status':'incomplete'"));
 const grade=f.api.gradeCell({cellDir:c.cellDir,privateGraderRoot:f.privateRoot,expectedPrivateSHA256:inspectPrivateGrader(f.privateRoot,f.root).sha256});assert.equal(grade.status,'incomplete');
 const review=f.api.recordReview({cellDir:c.cellDir,reviewerId:'independent-synthetic',meaningful:true,evidence:'Synthetic incomplete grader output remains a failed completion gate even with a reasoned review.'});assert.equal(review.fullTaskSuccess,false);assert.throws(()=>f.admit(1),/previous failure/);
});
