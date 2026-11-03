import {publicHandoffPolicy,prepareCellPublicHandoff,verifyCellPublicHandoff,readCellBootstrapReceipt} from './handoff-files.mjs';
import {verifyReadyLiveness}from './readiness.mjs';
import {hotpathBinding}from './hotpath-source.mjs';
import {execFileSync} from 'node:child_process';
import fs from 'node:fs';import path from 'node:path';
import {inventory,assertPermittedDelta,readBounded} from './files.mjs';import {digest,ARMS,LIMITS} from './protocol.mjs';
const repo=path.resolve(import.meta.dirname,'../..');
function readJSON(p){return JSON.parse(readBounded(p).toString('utf8'));}
function write(p,value){fs.writeFileSync(p,JSON.stringify(value,null,2)+'\n',{flag:'wx',mode:0o600});}
function copyInventory(source,target,expected){fs.mkdirSync(target);for(const rel of Object.keys(expected)){const dest=path.join(target,rel);fs.mkdirSync(path.dirname(dest),{recursive:true});const bytes=readBounded(path.join(source,rel));if(digest(bytes)!==expected[rel].sha256)throw Error('source changed');fs.writeFileSync(dest,bytes,{flag:'wx',mode:expected[rel].mode});}if(JSON.stringify(inventory(target))!==JSON.stringify(expected))throw Error('copy mismatch');}
function sourceBindings(){
 const tracked=execFileSync('git',['ls-files','-z','packages','experiments/native-dev'],{cwd:repo,maxBuffer:1048576,encoding:'utf8'}).split('\0').filter(Boolean);
 const bindings={};for(const p of [...tracked,'scripts/native-comparison/method.test.ts','.specplane/native-reconstruction-inventory.json','scripts/migration-inventory.mjs','scripts/check-specplane-migration.mjs','scripts/check-specplane-migration.test.mjs','scripts/test-cloud.mjs','scripts/test-cloud.test.mjs','scripts/native-fixture-controls.py','docs/dot-progress/native-interactive-reconstruction.md','docs/dot-progress/native-hotpath-extension-plan.md','docs/dot-progress/native-public-handoff-template.md','experiments/native-dev/manifest.json','experiments/native-dev/grade.py','package.json','package-lock.json',...fs.readdirSync(path.join(repo,'scripts/native-interactive')).filter(x=>/\.(?:mjs|mts|ts)$/.test(x)).map(x=>'scripts/native-interactive/'+x)]){const file=path.join(repo,p),st=fs.lstatSync(file);if(!st.isFile()||st.nlink!==1||st.size>8388608||fs.realpathSync(file)!==file)throw Error('unsafe source');bindings[p]=digest(readBounded(file,8388608));}
 return bindings;
}
function fingerprint(state){const keys=Object.keys(state).sort();if(keys.some(k=>/[^\x00-\x7f]/.test(k)))throw Error("non-ASCII fixture paths unsupported");return digest("{"+keys.map(k=>JSON.stringify(k)+": "+JSON.stringify(state[k].sha256)).join(", ")+"}");}
/** Coordinator only. Cell-only preparation; campaign admission/frozen order is a separate required gate. */
export function prepareCell({cellDir,fixtureId,arm,venv,evidenceMode='synthetic-control'}){
 if(!ARMS.includes(arm))throw Error('unavailable arm');
 if(!['synthetic-control','native-assignment'].includes(evidenceMode))throw Error('invalid evidence mode');
 if(!path.isAbsolute(cellDir)||path.resolve(cellDir)!==cellDir)throw Error('absolute cell required');
 const manifest=readJSON(path.join(repo,'experiments/native-dev/manifest.json'));
 const fixture=manifest.fixtures.find(f=>f.id===fixtureId);if(!fixture)throw Error('unknown fixture');
 const original=inventory(path.join(repo,fixture.workspaceDir));
 fs.mkdirSync(cellDir);copyInventory(path.join(repo,fixture.workspaceDir),path.join(cellDir,'workspace'),original);
 const bindings=sourceBindings();
 const task=readBounded(path.join(repo,fixture.taskPath)).toString('utf8');fs.writeFileSync(path.join(cellDir,'TASK.md'),task,{flag:'wx'});
 const config={arm,root:path.join(cellDir,'workspace'),allowedWritePaths:fixture.allowedWritePaths,venv,journalDir:path.join(cellDir,'journal'),cellDir};
 write(path.join(cellDir,'admission.json'),{version:1,canonicalCampaign:false,evidenceMode,publicHandoffPolicy:publicHandoffPolicy(),fixtureId,arm,bindings,candidateBinding:hotpathBinding(),original,taskSHA256:digest(task),config});write(path.join(cellDir,'config.json'),config);
 return config;
}
/** Coordinator only, after normal cooperative close plus supervisor process-group check. */
export function snapshotSubmission({cellDir}){
 const admission=readJSON(path.join(cellDir,'admission.json')),config=readJSON(path.join(cellDir,'config.json')),supervision=readJSON(path.join(cellDir,'supervisor-result.json'));
 if(JSON.stringify(config)!==JSON.stringify(admission.config)||config.cellDir!==cellDir||config.root!==path.join(cellDir,'workspace'))throw Error('config changed');
 if(supervision.status!=='submitted'||supervision.cleanup!=='closed'||supervision.outcome?.status!=='submitted')throw Error('unclean supervision');
 if(JSON.stringify(admission.candidateBinding)!==JSON.stringify(hotpathBinding()))throw Error('candidate source changed');
 for(const [p,hash]of Object.entries(admission.bindings))if(digest(readBounded(path.join(repo,p),8388608))!==hash)throw Error('source changed');
 const names=fs.readdirSync(config.journalDir).sort();if(!names.length||names.some((n,i)=>n!==String(i+1).padStart(6,'0')+'.json'))throw Error('missing/noncontiguous journal');
 const terminal=readJSON(path.join(config.journalDir,names.at(-1)));if(terminal.type!=='terminal'||terminal.outcome.status!=='submitted'||terminal.outcome.cleanupStatus!=='closed')throw Error('missing successful terminal');
 if(JSON.stringify(supervision.outcome)!==JSON.stringify(terminal.outcome)||supervision.configSHA256!==digest(readBounded(path.join(cellDir,'config.json')))||supervision.admissionSHA256!==digest(readBounded(path.join(cellDir,'admission.json'))))throw Error('supervisor binding mismatch');
 const state=inventory(config.root);assertPermittedDelta(admission.original,state,config.allowedWritePaths);
 const dispatch=nativeEvidence(cellDir,admission);
 const snapshot=path.join(cellDir,'submission');copyInventory(config.root,snapshot,state);
 if(JSON.stringify(inventory(config.root))!==JSON.stringify(state))throw Error('workspace changed during snapshot');
 const result={evidenceMode:admission.evidenceMode,dispatch,status:'review_required',fullTaskSuccess:null,snapshot,inventory:state,admissionSHA256:digest(readBounded(path.join(cellDir,'admission.json'))),supervisorSHA256:digest(readBounded(path.join(cellDir,'supervisor-result.json'))),journalSHA256:digest(names.map(n=>[n,digest(readBounded(path.join(config.journalDir,n)))]))};
 write(path.join(cellDir,'submission-result.json'),result);return result;
}
/** Freeze order before actor assignments; failed cells stop this campaign rather than being skipped. */
export function freezeCampaign({campaignDir,cells,evidenceMode='synthetic-control'}){
 if(!['synthetic-control','native-assignment'].includes(evidenceMode))throw Error('invalid evidence mode');
 if(!path.isAbsolute(campaignDir)||!Array.isArray(cells)||!cells.length||cells.length>100)throw Error('invalid campaign');
 const seen=new Set();for(const c of cells){if(!/^[a-z0-9-]+$/.test(c.id)||seen.has(c.id)||!ARMS.includes(c.arm)||typeof c.fixtureId!=='string')throw Error('invalid cell');seen.add(c.id);}
 fs.mkdirSync(campaignDir);write(path.join(campaignDir,'campaign.json'),{version:1,canonicalCampaign:false,evidenceMode,publicHandoffPolicy:publicHandoffPolicy(),cells,bindings:sourceBindings(),candidateBinding:hotpathBinding(),limits:LIMITS,costMetric:'visible byte lower bound; no measured tokens/cache/billing',purpose:'small-set screening'});
}
export function admitNext({campaignDir,index,venv,actorId}){
 const campaign=readJSON(path.join(campaignDir,'campaign.json'));
 if(JSON.stringify(campaign.candidateBinding)!==JSON.stringify(hotpathBinding()))throw Error('frozen candidate changed');
 if(JSON.stringify(campaign.bindings)!==JSON.stringify(sourceBindings())||JSON.stringify(campaign.limits)!==JSON.stringify(LIMITS))throw Error('frozen campaign sources/limits changed');
 if(!Number.isInteger(index)||index<0||index>=campaign.cells.length||typeof actorId!=='string'||!actorId)throw Error('invalid assignment');
 for(let i=0;i<index;i++){
  const prior=path.join(campaignDir,campaign.cells[i].id),review=readJSON(path.join(prior,'review.json'));
  if(review.reviewerId===review.actorId||review.fullTaskSuccess!==true)throw Error('previous failure requires fixing before further runs');
  if(review.gradeSHA256!==digest(readBounded(path.join(prior,'grade.json')))||review.submissionResultSHA256!==digest(readBounded(path.join(prior,'submission-result.json')))||review.assignmentSHA256!==digest(readBounded(path.join(prior,'assignment.json'))))throw Error('prior review changed');
  const priorAdmission=readJSON(path.join(prior,'admission.json'));if(priorAdmission.evidenceMode!==campaign.evidenceMode||review.evidenceMode!==campaign.evidenceMode)throw Error('evidence mode changed');nativeEvidence(prior,priorAdmission,review.dispatch);
  const priorGrade=readJSON(path.join(prior,'grade.json'));
  const priorAssignment=readJSON(path.join(prior,'assignment.json')),priorSubmission=readJSON(path.join(prior,'submission-result.json'));
  if(priorAssignment.campaignSHA256!==digest(readBounded(path.join(campaignDir,'campaign.json')))||JSON.stringify(inventory(priorSubmission.snapshot))!==JSON.stringify(priorSubmission.inventory))throw Error('prior campaign/submission changed');
  if(review.actorId!==priorAssignment.actorId||review.submittedSHA256!==fingerprint(priorSubmission.inventory)||priorGrade.submittedSHA256!==review.submittedSHA256||review.regressionSHA256!==priorSubmission.inventory['tests/test_regressions.py']?.sha256)throw Error('prior review lineage mismatch');
 }
 const cell=campaign.cells[index],cellDir=path.join(campaignDir,cell.id),config=prepareCell({cellDir,fixtureId:cell.fixtureId,arm:cell.arm,venv,evidenceMode:campaign.evidenceMode});
 if(index>0){const first=readJSON(path.join(campaignDir,campaign.cells[0].id,'admission.json')),current=readJSON(path.join(cellDir,'admission.json'));if(JSON.stringify(first.bindings)!==JSON.stringify(current.bindings))throw Error('campaign sources changed');}
 write(path.join(cellDir,'assignment.json'),{actorId,index,campaignSHA256:digest(readBounded(path.join(campaignDir,'campaign.json')))});return config;
}
/** Runs only deterministic local grading after a clean snapshot, never a model or native assignment. */
export function gradeCell({cellDir}){
 const admission=readJSON(path.join(cellDir,'admission.json')),submission=readJSON(path.join(cellDir,'submission-result.json'));
 if(submission.admissionSHA256!==digest(readBounded(path.join(cellDir,'admission.json')))||JSON.stringify(inventory(submission.snapshot))!==JSON.stringify(submission.inventory))throw Error('submission changed');
 if(JSON.stringify(admission.candidateBinding)!==JSON.stringify(hotpathBinding()))throw Error('candidate source changed');
 for(const [p,hash]of Object.entries(admission.bindings))if(digest(readBounded(path.join(repo,p),8388608))!==hash)throw Error('source changed');
 nativeEvidence(cellDir,admission,submission.dispatch);
 const output=execFileSync('/usr/bin/python3',[path.join(repo,'experiments/native-dev/grade.py'),admission.fixtureId,submission.snapshot],{timeout:45000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8'},encoding:'utf8'});
 const grade=JSON.parse(output);if(grade.fixture!==admission.fixtureId||grade.fullTaskSuccess!==null||!grade.submittedSHA256||!grade.fixtureSHA256)throw Error('invalid grade');
 if(JSON.stringify(inventory(submission.snapshot))!==JSON.stringify(submission.inventory))throw Error('submission mutated during grade');
 write(path.join(cellDir,'grade.json'),grade);return grade;
}
/** Independent review is procedural, not authentication or automatic proof of meaningful tests. */
export function recordReview({cellDir,reviewerId,meaningful,evidence}){
 const assignment=readJSON(path.join(cellDir,'assignment.json')),grade=readJSON(path.join(cellDir,'grade.json')),submission=readJSON(path.join(cellDir,'submission-result.json'));
 if(typeof reviewerId!=='string'||!reviewerId||reviewerId===assignment.actorId||typeof meaningful!=='boolean'||typeof evidence!=='string'||evidence.trim().length<40)throw Error('independent reasoned review required');
 if(JSON.stringify(inventory(submission.snapshot))!==JSON.stringify(submission.inventory)||grade.submittedSHA256!==fingerprint(submission.inventory))throw Error('submission changed');
 const admission=readJSON(path.join(cellDir,'admission.json'));if(JSON.stringify(admission.candidateBinding)!==JSON.stringify(hotpathBinding()))throw Error('candidate source changed');if(submission.admissionSHA256!==digest(readBounded(path.join(cellDir,'admission.json')))||JSON.stringify(admission.bindings)!==JSON.stringify(sourceBindings()))throw Error('review source lineage changed');
 const fixture=readJSON(path.join(repo,'experiments/native-dev/manifest.json')).fixtures.find(f=>f.id===admission.fixtureId);if(grade.fixture!==admission.fixtureId||grade.fixtureSHA256!==fingerprint(inventory(path.dirname(path.join(repo,fixture.workspaceDir)))))throw Error('grade fixture mismatch');
 const regression=submission.inventory['tests/test_regressions.py'];
 if(meaningful&&!regression)throw Error('missing regression tests');
 const dispatch=nativeEvidence(cellDir,admission,submission.dispatch);
 if(dispatch?.nativeTaskId===reviewerId)throw Error('actual native actor cannot review itself');
 const result={evidenceMode:admission.evidenceMode,dispatch,reviewerId,actorId:assignment.actorId,meaningful,evidence,fullTaskSuccess:meaningful&&grade.executableChecksPassed===true&&grade.status==='review_required',gradeSHA256:digest(readBounded(path.join(cellDir,'grade.json'))),submissionResultSHA256:digest(readBounded(path.join(cellDir,'submission-result.json'))),submittedSHA256:grade.submittedSHA256,fixtureSHA256:grade.fixtureSHA256,regressionSHA256:regression?.sha256??null,assignmentSHA256:digest(readBounded(path.join(cellDir,'assignment.json')))};
 write(path.join(cellDir,'review.json'),result);return result;
}
/** Produce only the public task/ready artifact for a source-verified native cell. */
export function preparePublicHandoff({cellDir}){
 const admission=readJSON(path.join(cellDir,'admission.json'));
 if(admission.evidenceMode!=='native-assignment'||JSON.stringify(admission.bindings)!==JSON.stringify(sourceBindings())||JSON.stringify(admission.candidateBinding)!==JSON.stringify(hotpathBinding()))throw Error('public handoff source mismatch');
 return prepareCellPublicHandoff({cellDir});
}
/** Reconstruct intended bytes before the one coordinator intent; this does not dispatch an actor. */
export function verifyPublicHandoffForDispatch({cellDir}){
 const admission=readJSON(path.join(cellDir,'admission.json'));
 if(JSON.stringify(admission.bindings)!==JSON.stringify(sourceBindings()))throw Error('public handoff source changed');
 return verifyCellPublicHandoff({cellDir});
}
/** Manual coordinator dispatch evidence only. Does not create, message, or schedule any actor. */
export function recordActorDispatchIntent({cellDir,actorId,assignmentSHA256,handoffSHA256,capabilitySHA256}){
 const admission=readJSON(path.join(cellDir,'admission.json'));
 if(admission.evidenceMode!=='native-assignment'||JSON.stringify(admission.bindings)!==JSON.stringify(sourceBindings())||JSON.stringify(admission.candidateBinding)!==JSON.stringify(hotpathBinding()))throw Error('native dispatch source mismatch');
 const assignment=readJSON(path.join(cellDir,'assignment.json')),start=readJSON(path.join(cellDir,'supervisor-start.json')),ready=readJSON(path.join(cellDir,'supervisor-ready.json'));
 if(assignmentSHA256!==digest(readBounded(path.join(cellDir,'assignment.json'))))throw Error('assignment changed');
 if(assignment.actorId!==actorId||fs.existsSync(path.join(cellDir,'supervisor-result.json')))throw Error('wrong actor or completed cell');
 if(start.configSHA256!==digest(readBounded(path.join(cellDir,'config.json')))||start.admissionSHA256!==digest(readBounded(path.join(cellDir,'admission.json')))||ready.configSHA256!==start.configSHA256||ready.admissionSHA256!==start.admissionSHA256||ready.supervisorStartSHA256!==digest(readBounded(path.join(cellDir,'supervisor-start.json'))))throw Error('ready/source binding mismatch');
 const readiness=verifyReadyLiveness({start,ready}),handoff=verifyCellPublicHandoff({cellDir});
 if(handoff.handoffSHA256!==handoffSHA256||handoff.capabilitySHA256!==capabilitySHA256)throw Error('intended public handoff changed');
 const intent={readiness,handoff,actorId,phase:'manual-dispatch-intent',utc:new Date().toISOString(),monotonicMs:Number(process.hrtime.bigint())/1e6,clockScope:'coordinator observation only; no cross-process duration inferred',readySHA256:digest(readBounded(path.join(cellDir,'supervisor-ready.json'))),assignmentSHA256:digest(readBounded(path.join(cellDir,'assignment.json')))};
 write(path.join(cellDir,'actor-dispatch-intent.json'),intent);return intent;
}
/** Record returned actor identity after the coordinator dispatches through supported native tooling. */
export function recordActorDispatchReceipt({cellDir,actorId,nativeTaskId,receiptReference}){
 const intent=readJSON(path.join(cellDir,'actor-dispatch-intent.json'));if(intent.actorId!==actorId)throw Error('actor identity mismatch');
 if(typeof nativeTaskId!=='string'||!nativeTaskId.trim()||typeof receiptReference!=='string'||!receiptReference.trim())throw Error('actual native identity and receipt reference required');
 const receipt={actorId,nativeTaskId,receiptReference,phase:'manual-dispatch-receipt',utc:new Date().toISOString(),intentSHA256:digest(readBounded(path.join(cellDir,'actor-dispatch-intent.json'))),verification:'coordinator supplied native tool receipt; procedural, not authenticated by this file'};
 write(path.join(cellDir,'actor-dispatch-receipt.json'),receipt);return receipt;
}
/** Required lineage prevents synthetic controls from silently becoming native result evidence. */
function nativeEvidence(cellDir,admission,expected){
 if(admission.evidenceMode==='synthetic-control'){if(expected!==undefined&&expected!==null)throw Error('synthetic dispatch mismatch');return null;}
 if(admission.evidenceMode!=='native-assignment')throw Error('unknown evidence mode');
 const assignment=readJSON(path.join(cellDir,'assignment.json')),intent=readJSON(path.join(cellDir,'actor-dispatch-intent.json')),receipt=readJSON(path.join(cellDir,'actor-dispatch-receipt.json')),ready=readJSON(path.join(cellDir,'supervisor-ready.json'));
 const bootstrap=readCellBootstrapReceipt({cellDir});
 const hashes={handoffSHA256:bootstrap.description.handoffSHA256,capabilitySHA256:bootstrap.description.capabilitySHA256,bootstrapReceiptSHA256:bootstrap.receiptSHA256,bootstrapAttemptSHA256:bootstrap.attemptSHA256,bootstrapOutputBytes:bootstrap.receipt.emittedOutput.bytes,bootstrapOutputSHA256:bootstrap.receipt.emittedOutput.sha256,supervisorSHA256:digest(readBounded(path.join(cellDir,'supervisor-result.json'))),intentSHA256:digest(readBounded(path.join(cellDir,'actor-dispatch-intent.json'))),receiptSHA256:digest(readBounded(path.join(cellDir,'actor-dispatch-receipt.json'))),nativeTaskId:receipt.nativeTaskId,receiptReference:receipt.receiptReference};
 if(intent.actorId!==assignment.actorId||receipt.actorId!==assignment.actorId||typeof receipt.nativeTaskId!=='string'||!receipt.nativeTaskId.trim()||typeof receipt.receiptReference!=='string'||!receipt.receiptReference.trim()||receipt.intentSHA256!==hashes.intentSHA256||intent.assignmentSHA256!==digest(readBounded(path.join(cellDir,'assignment.json')))||intent.readySHA256!==digest(readBounded(path.join(cellDir,'supervisor-ready.json')))||ready.admissionSHA256!==digest(readBounded(path.join(cellDir,'admission.json'))))throw Error('native dispatch lineage mismatch');
 const supervision=readJSON(path.join(cellDir,'supervisor-result.json')),start=readJSON(path.join(cellDir,'supervisor-start.json'));
 const observations=supervision.timing?.observations,acks=observations?.filter(e=>e.type==='coordinator-control-ack')??[],inputs=observations?.filter(e=>e.type==='actor-input-start')??[];
 if(intent.handoff?.handoffSHA256!==hashes.handoffSHA256||intent.handoff?.capabilitySHA256!==hashes.capabilitySHA256||supervision.bootstrap?.receiptSHA256!==hashes.bootstrapReceiptSHA256||supervision.bootstrap?.outputBytes!==hashes.bootstrapOutputBytes||supervision.bootstrap?.outputSHA256!==hashes.bootstrapOutputSHA256||acks[0]?.handoffSHA256!==hashes.handoffSHA256||acks[0]?.capabilitySHA256!==hashes.capabilitySHA256||inputs[0]?.bootstrapReceiptSHA256!==hashes.bootstrapReceiptSHA256)throw Error('native public bootstrap evidence mismatch');
 if(supervision.coordinatorControls!==1||acks.length!==1||inputs.length!==1||acks[0].intentSHA256!==hashes.intentSHA256||acks[0].actorId!==assignment.actorId||acks[0].assignmentSHA256!==intent.assignmentSHA256||inputs[0].actorId!==assignment.actorId||inputs[0].assignmentSHA256!==intent.assignmentSHA256||start.assignmentSHA256!==intent.assignmentSHA256||supervision.supervisorStartSHA256!==digest(readBounded(path.join(cellDir,'supervisor-start.json')))||ready.supervisorStartSHA256!==supervision.supervisorStartSHA256)throw Error('native dispatch acknowledgement missing or mismatched');
 if(![ready.monotonicMs,acks[0].monotonicMs,inputs[0].monotonicMs,start.deadlineMonotonicMs].every(Number.isFinite)||ready.monotonicMs>acks[0].monotonicMs||acks[0].monotonicMs>inputs[0].monotonicMs||inputs[0].monotonicMs>=start.deadlineMonotonicMs||observations.indexOf(acks[0])>=observations.indexOf(inputs[0]))throw Error('native dispatch ordering invalid');
 if(expected!==undefined&&JSON.stringify(hashes)!==JSON.stringify(expected))throw Error('native dispatch evidence changed');
 return hashes;
}
