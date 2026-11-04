import {completionBinding,NATIVE_LIMITS_MANIFEST,encodeFinalSubmissionFrame} from './completion-lane.mjs';
import {verifyNativeCompletionEvidence} from './native-completion.mjs';
import {verifyNativeEventEvidence} from './native-events.mjs';
import {auditScreeningEvidence,verifyScreeningAudit} from './screening-audit.mjs';
import {SCREENING_MODE,admissionMode,validateScreeningControls,screeningSourceEvidence,screeningArms,inspectPrivateGrader,screeningLimitations} from './cooperative-screening.mjs';
import {checkRuntimePolicy,verifyCellCheckRuntime} from './check-runtime.mjs';
import {validateActionReceiptEvidence} from './action-receipt-files.mjs';
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
 const bindings={};for(const p of [...tracked,'packages/tools/python/aiw_sidecar/offline_check.py','packages/tools/python/aiw_sidecar/offline_check_runtime.json','scripts/native-comparison/method.test.ts','.specplane/native-reconstruction-inventory.json','.specplane/native-offline-check-inventory.json','scripts/migration-inventory.mjs','scripts/check-specplane-migration.mjs','scripts/check-specplane-migration.test.mjs','scripts/test-cloud.mjs','scripts/test-cloud.test.mjs','scripts/native-fixture-controls.py','docs/dot-progress/native-interactive-reconstruction.md','docs/dot-progress/native-hotpath-extension-plan.md','docs/dot-progress/native-public-handoff-template.md','docs/dot-progress/native-action-receipt-proposal.md','docs/dot-progress/native-offline-check-adaptation.md','experiments/native-dev/manifest.json','experiments/native-dev/grade.py','package.json','package-lock.json',...fs.readdirSync(path.join(repo,'scripts/native-interactive')).filter(x=>/\.(?:mjs|mts|ts)$/.test(x)||x==='native-completion-response-contract.txt').map(x=>'scripts/native-interactive/'+x)]){const file=path.join(repo,p),st=fs.lstatSync(file);if(!st.isFile()||st.nlink!==1||st.size>8388608||fs.realpathSync(file)!==file)throw Error('unsafe source');bindings[p]=digest(readBounded(file,8388608));}
 return bindings;
}
/** One mode-aware verifier; default full admission keeps both historical source gates. */
function sourceEvidence(record={}){
 const mode=admissionMode(record.admissionMode);
 if(mode==='full')return {bindings:sourceBindings(),candidateBinding:hotpathBinding()};
 validateScreeningControls(record.screeningControls);
 if(record.config&&!/^[a-f0-9]{64}$/.test(record.privateAbsenceSHA256))throw Error('per-cell private absence attestation changed');
 const selectedArms=screeningArms(record.selectedArms??[record.arm]);
 if(record.arm&&!selectedArms.includes(record.arm))throw Error('cell arm not selected');
 if(record.cells&&JSON.stringify(screeningArms(record.cells.map(c=>c.arm)))!==JSON.stringify(selectedArms))throw Error('campaign selected arms changed');
 return {...screeningSourceEvidence(repo),candidateBinding:selectedArms.includes('branch-hotpath2')?hotpathBinding():null};
}
/** Revalidate mode, frozen public identity and all selected candidate bindings. */
function verifySources(record){
 if((record.cells?.some(c=>['orchestrate-off','orchestrate-on'].includes(c.arm))||['orchestrate-off','orchestrate-on'].includes(record.arm))&&JSON.stringify(record.nativeCompletionLimits)!==JSON.stringify(NATIVE_LIMITS_MANIFEST))throw Error('frozen native limits changed');
 const expected=sourceEvidence(record);
 for(const key of ['bindings','candidateBinding','publicSourceIdentity'])if(JSON.stringify(record[key])!==JSON.stringify(expected[key]))throw Error('source or admission identity changed');
 if(record.admissionMode===SCREENING_MODE&&record.config){
  const cellDir=record.config.cellDir,assignment=readJSON(path.join(cellDir,'assignment.json')),campaignBytes=readBounded(path.join(path.dirname(cellDir),'campaign.json')),campaign=JSON.parse(campaignBytes),cell=campaign.cells?.[assignment.index];
  if(assignment.privateAbsenceSHA256!==record.privateAbsenceSHA256||assignment.campaignSHA256!==digest(campaignBytes)||!cell||cell.id!==path.basename(cellDir)||cell.fixtureId!==record.fixtureId||cell.arm!==record.arm)throw Error('cooperative campaign lineage changed');
  for(const key of ['admissionMode','evidenceMode','bindings','candidateBinding','publicSourceIdentity','screeningControls','selectedArms'])if(JSON.stringify(record[key])!==JSON.stringify(campaign[key]))throw Error('cooperative cell admission changed');
 }
 return expected;
}
/** Rebuild native integrity evidence from fixed owner paths, requiring bilateral clean close. */
export function verifyCellNativeCompletionEvidence({cellDir,admission,supervision}){
 if(!['orchestrate-off','orchestrate-on'].includes(admission.arm))return undefined;
 if(fs.existsSync(path.join(cellDir,'native-lane-failure.json')))throw Error('native supervisor fatal evidence');
 if(supervision.evidenceMode!==admission.evidenceMode||supervision.outcome?.evidenceMode!==admission.evidenceMode)throw Error('native evidence mode changed');
 const lane=supervision.completionLane;
 if(supervision.status!=='submitted'||supervision.cleanup!=='closed'||supervision.reason||supervision.outcome?.status!=='submitted'||supervision.outcome?.fatalReason||!lane||lane.failed||lane.fatalReason||lane.pending!==null||!lane.closed)throw Error('native completion close incomplete');
 const binding=completionBinding(admission,digest(readBounded(path.join(cellDir,'admission.json'))),path.basename(cellDir));
 const completion=verifyNativeCompletionEvidence({cellDir,binding,requireComplete:true});
 const event=verifyNativeEventEvidence({cellDir,binding,completionEvidence:completion,requireComplete:true});
 if(completion.accepted.length===0||completion.attempts===0||event.eventCount===0)throw Error('empty native evidence cannot support snapshot or comparison');
 if(JSON.stringify(lane.closeEvidence)!==JSON.stringify({completion:completion.summary,event:event.summary})||lane.sequence!==completion.attempts)throw Error('native completion close evidence changed');
 return {completion,event};
}
/** Reconstruct the approved relay evidence from fixed retained files, never actor-selected paths. */
function screeningAuditInputs(cellDir,submission){
 const admission=readJSON(path.join(cellDir,'admission.json')),assignment=readJSON(path.join(cellDir,'assignment.json'));
 const registry=readJSON(path.join(path.dirname(cellDir),'canary-registry.json'));
 const observations=readJSON(path.join(cellDir,'audit-observations.json'));
 if(observations.version!==1||observations.nativeToolLogCoverage!=='unavailable'||observations.subprocessReadCoverage!=='unobserved'||!Array.isArray(observations.accessFindings))throw Error('invalid procedural audit observations');
 const source=(id,kind,bytes)=>({id,kind,scope:{role:'solver',phase:'solve',cellId:path.basename(cellDir)},bytes,expectedSHA256:digest(bytes),complete:true});
 const receiptDir=path.join(cellDir,'action-receipts'),names=fs.readdirSync(receiptDir).sort(),inputNames=names.filter(n=>/^\d{6}\.input\.jsonl$/.test(n)),feedbackNames=names.filter(n=>/^\d{6}\.feedback\.jsonl$/.test(n));
 if(!inputNames.length||inputNames.length>LIMITS.rounds||inputNames.length!==feedbackNames.length||inputNames.some((n,i)=>n!==String(i+1).padStart(6,'0')+'.input.jsonl')||feedbackNames.some((n,i)=>n!==String(i+1).padStart(6,'0')+'.feedback.jsonl'))throw Error('incomplete audit relay sources');
 const journalDir=path.join(cellDir,'journal'),journals=fs.readdirSync(journalDir).sort();if(!journals.length||journals.length>2048||journals.some((n,i)=>n!==String(i+1).padStart(6,'0')+'.json'))throw Error('incomplete audit journal');
 const join=(root,files)=>Buffer.concat(files.map(name=>readBounded(path.join(root,name))));
 const sources=[source('solver','solver-output',join(receiptDir,inputNames)),source('relay','relay',Buffer.concat([readBounded(path.join(cellDir,'ready-frame.jsonl')),join(receiptDir,feedbackNames)])),source('journal','host-journal',join(journalDir,journals))];
 const native=verifyCellNativeCompletionEvidence({cellDir,admission,supervision:readJSON(path.join(cellDir,'supervisor-result.json'))});
 if(native){const groups=new Map();for(const file of [...native.completion.files,...native.event.files]){const bytes=readBounded(file.path,8388608);if(bytes.length!==file.bytes||digest(bytes)!==file.sha256)throw Error('native audit source changed');if(!groups.has(file.kind))groups.set(file.kind,[]);groups.get(file.kind).push(bytes);}for(const kind of ['completion-request','completion-response','completion-control','native-event'])if(!groups.get(kind)?.length)throw Error('missing required native audit source class');for(const [kind,chunks] of groups)sources.push(source('native/'+kind,kind,Buffer.concat(chunks)));}
 if(JSON.stringify(inventory(submission.snapshot))!==JSON.stringify(submission.inventory))throw Error('audited submission changed');
 for(const rel of Object.keys(submission.inventory).sort())sources.push(source('submission/'+rel,'submission',readBounded(path.join(submission.snapshot,rel))));
 const submissionResultBytes=readBounded(path.join(cellDir,'submission-result.json'));
 return {registry,expectedRegistrySHA256:admission.screeningControls.canaryRegistrySHA256,campaignSHA256:assignment.campaignSHA256,submissionResultBytes,expectedSubmissionSHA256:digest(submissionResultBytes),cellId:path.basename(cellDir),sources,requiredSourceIds:[...new Set([...sources.map(s=>s.id),...(native?['native/completion-request','native/completion-response','native/completion-control','native/native-event']:[])])],accessFindings:observations.accessFindings};
}
/** Read-only post-submit audit; callers persist its report once, without claiming complete native logs. */
export function inspectCellScreeningAudit({cellDir}){
 const admission=readJSON(path.join(cellDir,'admission.json')),submission=readJSON(path.join(cellDir,'submission-result.json'));
 if(admission.admissionMode!==SCREENING_MODE)throw Error('cooperative audit requires explicit mode');
 verifySources(admission);nativeEvidence(cellDir,admission,submission.dispatch);
 return auditScreeningEvidence(screeningAuditInputs(cellDir,submission));
}
/** Recompute the actual retained bytes; never trust a report's eligibility boolean by itself. */
function screeningAudit(cellDir,submission){
 const bytes=readBounded(path.join(cellDir,'audit.json')),report=JSON.parse(bytes);
 verifyScreeningAudit({report,...screeningAuditInputs(cellDir,submission)});
 if(report.comparisonEligible!==true||report.assessment!=='no-contamination-detected/partial-audit')throw Error('cooperative audit incomplete or contaminated');
 return digest(bytes);
}
/** Only the grader package's public starting inputs must match solve-time admission. */
function verifyGraderPublicInputs(grader,admission){
 const manifest=readJSON(path.join(grader.root,'manifest.json'));
 if(digest(readBounded(path.join(grader.root,'manifest.json')))!==admission.bindings['experiments/native-dev/manifest.json'])throw Error('private grader public manifest mismatch');
 const fixture=manifest.fixtures.find(f=>f.id===admission.fixtureId);if(!fixture)throw Error('private grader fixture missing');
 if(JSON.stringify(inventory(path.join(grader.root,admission.fixtureId,'workspace')))!==JSON.stringify(admission.original))throw Error('private grader public fixture inventory mismatch');
 for(const [rel,hash]of Object.entries(admission.bindings))if(rel===fixture.taskPath||rel.startsWith(fixture.workspaceDir+'/')){
  const suffix=rel.slice('experiments/native-dev/'.length);
  if(digest(readBounded(path.join(grader.root,suffix)))!==hash)throw Error('private grader public fixture mismatch');
 }
 return fingerprint(inventory(path.join(grader.root,admission.fixtureId)));
}
function fingerprint(state){const keys=Object.keys(state).sort();if(keys.some(k=>/[^\x00-\x7f]/.test(k)))throw Error("non-ASCII fixture paths unsupported");return digest("{"+keys.map(k=>JSON.stringify(k)+": "+JSON.stringify(state[k].sha256)).join(", ")+"}");}
/** Public result whitelist excludes hidden unittest text and arbitrary grader fields. */
function cooperativeGradeSummary(raw){
 if(typeof raw.executableChecksPassed!=='boolean'||!['review_required','failed','incomplete'].includes(raw.status))throw Error('invalid cooperative grade outcome');
 return {fixture:raw.fixture,status:raw.status,fullTaskSuccess:raw.fullTaskSuccess,submittedSHA256:raw.submittedSHA256,fixtureSHA256:raw.fixtureSHA256,executableChecksPassed:raw.executableChecksPassed};
}
/** Bind an independently verified private backup before recoverable local-output removal.
 * This records a coordinator-provided connector receipt, not remote-storage authentication.
 */
export function recordGradingOutputCheckpoint({cellDir,libraryFileId,versionId,observedSHA256}){
 const grade=readJSON(path.join(cellDir,'grade.json')),review=readJSON(path.join(cellDir,'review.json')),raw=readBounded(path.join(cellDir,'grade-output.json'));
 for(const value of [libraryFileId,versionId])if(typeof value!=='string'||!value||value.length>512||/[\r\n\0]/.test(value))throw Error('verified private storage identity required');
 if(review.admissionMode!==SCREENING_MODE||review.gradeSHA256!==digest(readBounded(path.join(cellDir,'grade.json')))||observedSHA256!==digest(raw)||grade.cooperativeProvenance?.graderOutputSHA256!==observedSHA256)throw Error('private output checkpoint mismatch');
 const receipt={version:1,kind:'cooperative-private-output-checkpoint',libraryFileId,versionId,rawSHA256:observedSHA256,rawBytes:raw.length,reviewSHA256:digest(readBounded(path.join(cellDir,'review.json'))),scope:'coordinator supplied verified storage receipt; recoverable raw output must be absent before another solve'};
 write(path.join(cellDir,'grade-output-checkpoint.json'),receipt);return receipt;
}
/** Later admission retains verified private-storage identity without restoring hidden output. */
function verifyPrivateOutputRetained(cellDir,grade){
 const checkpoint=readJSON(path.join(cellDir,'grade-output-checkpoint.json'));
 if(checkpoint.version!==1||checkpoint.kind!=='cooperative-private-output-checkpoint'||checkpoint.rawSHA256!==grade.cooperativeProvenance?.graderOutputSHA256||checkpoint.reviewSHA256!==digest(readBounded(path.join(cellDir,'review.json')))||!checkpoint.libraryFileId||!checkpoint.versionId)throw Error('private output checkpoint changed');
 if(fs.existsSync(path.join(cellDir,'grade-output.json')))throw Error('private grading output still present before solve');
}
/** Coordinator only. Cell-only preparation; campaign admission/frozen order is a separate required gate. */
export function prepareCell({cellDir,fixtureId,arm,venv,evidenceMode='synthetic-control',admissionMode:mode='full',screeningControls,selectedArms=[arm],privateAbsenceSHA256}){
 if(!ARMS.includes(arm))throw Error('unavailable arm');
 if(!['synthetic-control','native-assignment'].includes(evidenceMode))throw Error('invalid evidence mode');
 if(!path.isAbsolute(cellDir)||path.resolve(cellDir)!==cellDir)throw Error('absolute cell required');
 if(mode===SCREENING_MODE&&!/^[a-f0-9]{64}$/.test(privateAbsenceSHA256))throw Error('per-cell private absence attestation required');
 const evidence=sourceEvidence({admissionMode:mode,screeningControls,selectedArms,arm});
 const manifest=readJSON(path.join(repo,'experiments/native-dev/manifest.json'));
 const fixture=manifest.fixtures.find(f=>f.id===fixtureId);if(!fixture)throw Error('unknown fixture');
 const original=inventory(path.join(repo,fixture.workspaceDir));
 fs.mkdirSync(cellDir);copyInventory(path.join(repo,fixture.workspaceDir),path.join(cellDir,'workspace'),original);
 const task=readBounded(path.join(repo,fixture.taskPath)).toString('utf8');fs.writeFileSync(path.join(cellDir,'TASK.md'),task,{flag:'wx'});
 const config={arm,root:path.join(cellDir,'workspace'),allowedWritePaths:fixture.allowedWritePaths,venv,journalDir:path.join(cellDir,'journal'),cellDir};
 write(path.join(cellDir,'admission.json'),{version:1,canonicalCampaign:false,evidenceMode,admissionMode:admissionMode(mode),...(mode===SCREENING_MODE?{screeningControls:validateScreeningControls(screeningControls),selectedArms:screeningArms(selectedArms),privateAbsenceSHA256,limitations:screeningLimitations()}:{}),...(['orchestrate-off','orchestrate-on'].includes(arm)?{nativeCompletionLimits:NATIVE_LIMITS_MANIFEST}:{}),publicHandoffPolicy:publicHandoffPolicy(),checkRuntimePolicy:checkRuntimePolicy(),fixtureId,arm,...evidence,original,taskSHA256:digest(task),config});write(path.join(cellDir,'config.json'),config);
 return config;
}
/** Coordinator only, after normal cooperative close plus supervisor process-group check. */
export function snapshotSubmission({cellDir}){
 const admission=readJSON(path.join(cellDir,'admission.json')),config=readJSON(path.join(cellDir,'config.json')),supervision=readJSON(path.join(cellDir,'supervisor-result.json'));
 if(JSON.stringify(config)!==JSON.stringify(admission.config)||config.cellDir!==cellDir||config.root!==path.join(cellDir,'workspace'))throw Error('config changed');
 if(supervision.status!=='submitted'||supervision.cleanup!=='closed'||supervision.outcome?.status!=='submitted'||supervision.reason||supervision.outcome?.fatalReason)throw Error('unclean supervision');
 const nativeCompletion=verifyCellNativeCompletionEvidence({cellDir,admission,supervision});
 verifySources(admission);
 const names=fs.readdirSync(config.journalDir).sort();if(!names.length||names.some((n,i)=>n!==String(i+1).padStart(6,'0')+'.json'))throw Error('missing/noncontiguous journal');
 const terminal=readJSON(path.join(config.journalDir,names.at(-1)));if(terminal.type!=='terminal'||terminal.outcome.status!=='submitted'||terminal.outcome.cleanupStatus!=='closed')throw Error('missing successful terminal');
 if(JSON.stringify(supervision.outcome)!==JSON.stringify(terminal.outcome)||supervision.configSHA256!==digest(readBounded(path.join(cellDir,'config.json')))||supervision.admissionSHA256!==digest(readBounded(path.join(cellDir,'admission.json'))))throw Error('supervisor binding mismatch');
 const state=inventory(config.root);assertPermittedDelta(admission.original,state,config.allowedWritePaths);
 const checkRuntimeSHA256=supervision.checkRuntimeSHA256!==undefined||admission.evidenceMode==='native-assignment'?verifyCellCheckRuntime({cellDir,admission,supervision}):undefined;
 const dispatch=nativeEvidence(cellDir,admission);
 const snapshot=path.join(cellDir,'submission');copyInventory(config.root,snapshot,state);
 if(JSON.stringify(inventory(config.root))!==JSON.stringify(state))throw Error('workspace changed during snapshot');
 const result={...(nativeCompletion?{nativeCompletion:{completion:nativeCompletion.completion.summary,event:nativeCompletion.event.summary}}:{}),evidenceMode:admission.evidenceMode,admissionMode:admissionMode(admission.admissionMode),...(admission.admissionMode===SCREENING_MODE?{limitations:screeningLimitations()}:{}),dispatch,checkRuntimeSHA256,status:'review_required',fullTaskSuccess:null,snapshot,inventory:state,admissionSHA256:digest(readBounded(path.join(cellDir,'admission.json'))),supervisorSHA256:digest(readBounded(path.join(cellDir,'supervisor-result.json'))),journalSHA256:digest(names.map(n=>[n,digest(readBounded(path.join(config.journalDir,n)))]))};
 if(nativeCompletion)encodeFinalSubmissionFrame(result,supervision);
 if(nativeCompletion&&JSON.stringify(verifyCellNativeCompletionEvidence({cellDir,admission,supervision}))!==JSON.stringify(nativeCompletion))throw Error('native evidence changed during snapshot');
 write(path.join(cellDir,'submission-result.json'),result);return result;
}
/** Freeze order before actor assignments; failed cells stop this campaign rather than being skipped. */
export function freezeCampaign({campaignDir,cells,evidenceMode='synthetic-control',admissionMode:mode='full',screeningControls}){
 if(!['synthetic-control','native-assignment'].includes(evidenceMode))throw Error('invalid evidence mode');
 if(!path.isAbsolute(campaignDir)||!Array.isArray(cells)||!cells.length||cells.length>100)throw Error('invalid campaign');
 const seen=new Set();for(const c of cells){if(!/^[a-z0-9-]+$/.test(c.id)||seen.has(c.id)||!ARMS.includes(c.arm)||typeof c.fixtureId!=='string')throw Error('invalid cell');seen.add(c.id);}
 const selectedArms=screeningArms(cells.map(c=>c.arm)),evidence=sourceEvidence({admissionMode:mode,screeningControls,selectedArms});
 fs.mkdirSync(campaignDir);write(path.join(campaignDir,'campaign.json'),{version:1,canonicalCampaign:false,evidenceMode,admissionMode:admissionMode(mode),...(mode===SCREENING_MODE?{screeningControls:validateScreeningControls(screeningControls),selectedArms,limitations:screeningLimitations()}:{}),...(cells.some(c=>['orchestrate-off','orchestrate-on'].includes(c.arm))?{nativeCompletionLimits:NATIVE_LIMITS_MANIFEST}:{}),publicHandoffPolicy:publicHandoffPolicy(),checkRuntimePolicy:checkRuntimePolicy(),cells,...evidence,limits:LIMITS,costMetric:'visible byte lower bound; no measured tokens/cache/billing',purpose:'small-set screening'});
}
export function admitNext({campaignDir,index,venv,actorId,privateAbsenceSHA256}){
 const campaign=readJSON(path.join(campaignDir,'campaign.json'));
 if(JSON.stringify(campaign.checkRuntimePolicy)!==JSON.stringify(checkRuntimePolicy()))throw Error('frozen checker runtime policy changed');
 verifySources(campaign);
 if(JSON.stringify(campaign.limits)!==JSON.stringify(LIMITS))throw Error('frozen campaign limits changed');
 if(!Number.isInteger(index)||index<0||index>=campaign.cells.length||typeof actorId!=='string'||!actorId)throw Error('invalid assignment');
 for(let i=0;i<index;i++){
  const prior=path.join(campaignDir,campaign.cells[i].id),review=readJSON(path.join(prior,'review.json'));
  if(review.reviewerId===review.actorId||review.fullTaskSuccess!==true)throw Error('previous failure requires fixing before further runs');
  if(review.gradeSHA256!==digest(readBounded(path.join(prior,'grade.json')))||review.submissionResultSHA256!==digest(readBounded(path.join(prior,'submission-result.json')))||review.assignmentSHA256!==digest(readBounded(path.join(prior,'assignment.json'))))throw Error('prior review changed');
  const priorAdmission=readJSON(path.join(prior,'admission.json'));if(priorAdmission.evidenceMode!==campaign.evidenceMode||review.evidenceMode!==campaign.evidenceMode||admissionMode(priorAdmission.admissionMode)!==admissionMode(campaign.admissionMode)||admissionMode(review.admissionMode)!==admissionMode(campaign.admissionMode)||JSON.stringify(priorAdmission.publicSourceIdentity)!==JSON.stringify(campaign.publicSourceIdentity))throw Error('evidence mode changed');nativeEvidence(prior,priorAdmission,review.dispatch);
  if(campaign.admissionMode===SCREENING_MODE&&(review.auditSHA256!==screeningAudit(prior,readJSON(path.join(prior,'submission-result.json')))||review.gradeAttemptSHA256!==digest(readBounded(path.join(prior,'grade-attempt.json')))))throw Error('prior audit or grade attempt changed');
  const priorGrade=readJSON(path.join(prior,'grade.json'));
  if(campaign.admissionMode===SCREENING_MODE)verifyPrivateOutputRetained(prior,priorGrade);
  const priorAssignment=readJSON(path.join(prior,'assignment.json')),priorSubmission=readJSON(path.join(prior,'submission-result.json'));
  if(priorAssignment.campaignSHA256!==digest(readBounded(path.join(campaignDir,'campaign.json')))||JSON.stringify(inventory(priorSubmission.snapshot))!==JSON.stringify(priorSubmission.inventory))throw Error('prior campaign/submission changed');
  if(review.actorId!==priorAssignment.actorId||review.submittedSHA256!==fingerprint(priorSubmission.inventory)||priorGrade.submittedSHA256!==review.submittedSHA256||review.regressionSHA256!==priorSubmission.inventory['tests/test_regressions.py']?.sha256)throw Error('prior review lineage mismatch');
 }
 const cell=campaign.cells[index],cellDir=path.join(campaignDir,cell.id),config=prepareCell({cellDir,fixtureId:cell.fixtureId,arm:cell.arm,venv,evidenceMode:campaign.evidenceMode,admissionMode:campaign.admissionMode,screeningControls:campaign.screeningControls,selectedArms:campaign.selectedArms,privateAbsenceSHA256});
 if(index>0){const first=readJSON(path.join(campaignDir,campaign.cells[0].id,'admission.json')),current=readJSON(path.join(cellDir,'admission.json'));if(JSON.stringify(first.bindings)!==JSON.stringify(current.bindings))throw Error('campaign sources changed');}
 write(path.join(cellDir,'assignment.json'),{actorId,index,campaignSHA256:digest(readBounded(path.join(campaignDir,'campaign.json'))),...(campaign.admissionMode===SCREENING_MODE?{privateAbsenceSHA256}: {})});return config;
}
/** Runs only deterministic local grading after a clean snapshot, never a model or native assignment. */
export function gradeCell({cellDir,privateGraderRoot,expectedPrivateSHA256}){
 const admission=readJSON(path.join(cellDir,'admission.json')),submission=readJSON(path.join(cellDir,'submission-result.json'));
 if(submission.admissionSHA256!==digest(readBounded(path.join(cellDir,'admission.json')))||JSON.stringify(inventory(submission.snapshot))!==JSON.stringify(submission.inventory))throw Error('submission changed');
 verifySources(admission);
 nativeEvidence(cellDir,admission,submission.dispatch);
 const cooperative=admission.admissionMode===SCREENING_MODE;
 const auditSHA256=cooperative?screeningAudit(cellDir,submission):undefined;
 const privateGrader=cooperative?inspectPrivateGrader(privateGraderRoot,repo):undefined;
 if(cooperative&&(!/^[a-f0-9]{64}$/.test(expectedPrivateSHA256)||privateGrader.sha256!==expectedPrivateSHA256))throw Error('private grader commitment mismatch');
 const privateFixtureSHA256=cooperative?verifyGraderPublicInputs(privateGrader,admission):undefined;
 if(cooperative)write(path.join(cellDir,'grade-attempt.json'),{version:1,admissionMode:SCREENING_MODE,auditSHA256,privateGrader,privateFixtureSHA256,submissionResultSHA256:digest(readBounded(path.join(cellDir,'submission-result.json'))),limitations:screeningLimitations()});
 const gradeAttemptSHA256=cooperative?digest(readBounded(path.join(cellDir,'grade-attempt.json'))):undefined;
 let output;
 try{output=execFileSync('/usr/bin/python3',[cooperative?path.join(privateGrader.root,'grade.py'):path.join(repo,'experiments/native-dev/grade.py'),admission.fixtureId,submission.snapshot],{timeout:45000,maxBuffer:1048576,env:{PATH:'/usr/bin:/bin',PYTHONDONTWRITEBYTECODE:'1',PYTHONIOENCODING:'utf-8'},encoding:'utf8'});}
 catch(error){if(cooperative)write(path.join(cellDir,'grade-failed.json'),{gradeAttemptSHA256,status:error.status??null,signal:error.signal??null,stdout:String(error.stdout??''),stderr:String(error.stderr??''),scope:'failed grading attempt retained; stop further runs; subprocess cleanup not proven'});throw error;}
 if(cooperative)fs.writeFileSync(path.join(cellDir,'grade-output.json'),output,{flag:'wx',mode:0o600});
 if(cooperative&&digest(readBounded(path.join(cellDir,'grade-attempt.json')))!==gradeAttemptSHA256)throw Error('grade attempt changed during execution');
 if(cooperative&&inspectPrivateGrader(privateGrader.root,repo).sha256!==privateGrader.sha256)throw Error('private inputs mutated during grade');
 if(cooperative)verifySources(admission);
 const rawGrade=JSON.parse(output),grade=cooperative?cooperativeGradeSummary(rawGrade):rawGrade;if(grade.fixture!==admission.fixtureId||grade.fullTaskSuccess!==null||!grade.submittedSHA256||!grade.fixtureSHA256)throw Error('invalid grade');
 if(cooperative&&(grade.fixtureSHA256!==privateFixtureSHA256||grade.submittedSHA256!==fingerprint(submission.inventory)))throw Error('private grade identity mismatch');
 if(JSON.stringify(inventory(submission.snapshot))!==JSON.stringify(submission.inventory))throw Error('submission mutated during grade');
 if(cooperative)grade.cooperativeProvenance={gradeAttemptSHA256,graderOutputSHA256:digest(output),auditSHA256};
 write(path.join(cellDir,'grade.json'),grade);return grade;
}
/** Independent review is procedural, not authentication or automatic proof of meaningful tests. */
export function recordReview({cellDir,reviewerId,meaningful,evidence}){
 const assignment=readJSON(path.join(cellDir,'assignment.json')),grade=readJSON(path.join(cellDir,'grade.json')),submission=readJSON(path.join(cellDir,'submission-result.json'));
 if(typeof reviewerId!=='string'||!reviewerId||reviewerId===assignment.actorId||typeof meaningful!=='boolean'||typeof evidence!=='string'||evidence.trim().length<40)throw Error('independent reasoned review required');
 if(JSON.stringify(inventory(submission.snapshot))!==JSON.stringify(submission.inventory)||grade.submittedSHA256!==fingerprint(submission.inventory))throw Error('submission changed');
 const admission=readJSON(path.join(cellDir,'admission.json'));verifySources(admission);if(submission.admissionSHA256!==digest(readBounded(path.join(cellDir,'admission.json'))))throw Error('review source lineage changed');
 const cooperative=admission.admissionMode===SCREENING_MODE,auditSHA256=cooperative?screeningAudit(cellDir,submission):undefined;
 const attempt=cooperative?readJSON(path.join(cellDir,'grade-attempt.json')):undefined;
 if(cooperative){const raw=readBounded(path.join(cellDir,'grade-output.json')),parsed=cooperativeGradeSummary(JSON.parse(raw));if(digest(raw)!==grade.cooperativeProvenance?.graderOutputSHA256||JSON.stringify({...parsed,cooperativeProvenance:grade.cooperativeProvenance})!==JSON.stringify(grade))throw Error('retained grader output changed');}
 if(cooperative&&(grade.cooperativeProvenance?.gradeAttemptSHA256!==digest(readBounded(path.join(cellDir,'grade-attempt.json')))||grade.cooperativeProvenance?.auditSHA256!==auditSHA256||attempt.admissionMode!==SCREENING_MODE||attempt.auditSHA256!==auditSHA256||attempt.submissionResultSHA256!==digest(readBounded(path.join(cellDir,'submission-result.json')))||inspectPrivateGrader(attempt.privateGrader.root,repo).sha256!==attempt.privateGrader.sha256||verifyGraderPublicInputs(attempt.privateGrader,admission)!==attempt.privateFixtureSHA256))throw Error('private grading lineage changed');
 const fixture=readJSON(path.join(repo,'experiments/native-dev/manifest.json')).fixtures.find(f=>f.id===admission.fixtureId);if(grade.fixture!==admission.fixtureId||grade.fixtureSHA256!==(cooperative?attempt.privateFixtureSHA256:fingerprint(inventory(path.dirname(path.join(repo,fixture.workspaceDir))))))throw Error('grade fixture mismatch');
 const regression=submission.inventory['tests/test_regressions.py'];
 if(meaningful&&!regression)throw Error('missing regression tests');
 const dispatch=nativeEvidence(cellDir,admission,submission.dispatch);
 if(dispatch?.nativeTaskId===reviewerId)throw Error('actual native actor cannot review itself');
 const result={evidenceMode:admission.evidenceMode,admissionMode:admissionMode(admission.admissionMode),...(cooperative?{auditSHA256,gradeAttemptSHA256:digest(readBounded(path.join(cellDir,'grade-attempt.json'))),limitations:screeningLimitations()}:{}),dispatch,reviewerId,actorId:assignment.actorId,meaningful,evidence,fullTaskSuccess:meaningful&&grade.executableChecksPassed===true&&grade.status==='review_required',gradeSHA256:digest(readBounded(path.join(cellDir,'grade.json'))),submissionResultSHA256:digest(readBounded(path.join(cellDir,'submission-result.json'))),submittedSHA256:grade.submittedSHA256,fixtureSHA256:grade.fixtureSHA256,regressionSHA256:regression?.sha256??null,assignmentSHA256:digest(readBounded(path.join(cellDir,'assignment.json')))};
 write(path.join(cellDir,'review.json'),result);return result;
}
/** Produce only the public task/ready artifact for a source-verified native cell. */
export function preparePublicHandoff({cellDir}){
 const admission=readJSON(path.join(cellDir,'admission.json'));
 verifySources(admission);if(admission.evidenceMode!=='native-assignment'&&!(admission.evidenceMode==='synthetic-control'&&['orchestrate-off','orchestrate-on'].includes(admission.arm)))throw Error('public handoff source mismatch');
 return prepareCellPublicHandoff({cellDir});
}
/** Reconstruct intended bytes before the one coordinator intent; this does not dispatch an actor. */
export function verifyPublicHandoffForDispatch({cellDir}){
 const admission=readJSON(path.join(cellDir,'admission.json'));
 verifySources(admission);
 return verifyCellPublicHandoff({cellDir});
}
/** Manual coordinator dispatch evidence only. Does not create, message, or schedule any actor. */
export function recordActorDispatchIntent({cellDir,actorId,assignmentSHA256,handoffSHA256,capabilitySHA256}){
 const admission=readJSON(path.join(cellDir,'admission.json'));
 verifySources(admission);const syntheticOrchestrate=admission.evidenceMode==='synthetic-control'&&['orchestrate-off','orchestrate-on'].includes(admission.arm);if(admission.evidenceMode!=='native-assignment'&&!syntheticOrchestrate)throw Error('native dispatch source mismatch');if(syntheticOrchestrate&&fs.existsSync(path.join(cellDir,'actor-dispatch-receipt.json')))throw Error('synthetic control forbids actor dispatch receipt');
 const assignment=readJSON(path.join(cellDir,'assignment.json')),start=readJSON(path.join(cellDir,'supervisor-start.json')),ready=readJSON(path.join(cellDir,'supervisor-ready.json'));
 if(assignmentSHA256!==digest(readBounded(path.join(cellDir,'assignment.json'))))throw Error('assignment changed');
 if(assignment.actorId!==actorId||fs.existsSync(path.join(cellDir,'supervisor-result.json')))throw Error('wrong actor or completed cell');
 if(start.configSHA256!==digest(readBounded(path.join(cellDir,'config.json')))||start.admissionSHA256!==digest(readBounded(path.join(cellDir,'admission.json')))||ready.configSHA256!==start.configSHA256||ready.admissionSHA256!==start.admissionSHA256||ready.supervisorStartSHA256!==digest(readBounded(path.join(cellDir,'supervisor-start.json'))))throw Error('ready/source binding mismatch');
 const readiness=verifyReadyLiveness({start,ready}),handoff=verifyCellPublicHandoff({cellDir});
 if(handoff.handoffSHA256!==handoffSHA256||handoff.capabilitySHA256!==capabilitySHA256)throw Error('intended public handoff changed');
 const intent={readiness,handoff,actorId,phase:syntheticOrchestrate?'synthetic-control-intent':'manual-dispatch-intent',utc:new Date().toISOString(),monotonicMs:Number(process.hrtime.bigint())/1e6,clockScope:'coordinator observation only; no cross-process duration inferred',readySHA256:digest(readBounded(path.join(cellDir,'supervisor-ready.json'))),assignmentSHA256:digest(readBounded(path.join(cellDir,'assignment.json')))};
 write(path.join(cellDir,'actor-dispatch-intent.json'),intent);return intent;
}
/** Record returned actor identity after the coordinator dispatches through supported native tooling. */
export function recordActorDispatchReceipt({cellDir,actorId,nativeTaskId,receiptReference}){
 const mode=readJSON(path.join(cellDir,'admission.json')).evidenceMode;if(mode==='synthetic-control')throw Error('synthetic control forbids actor dispatch receipt');
 const intent=readJSON(path.join(cellDir,'actor-dispatch-intent.json'));if(intent.actorId!==actorId)throw Error('actor identity mismatch');
 if(typeof nativeTaskId!=='string'||!nativeTaskId.trim()||typeof receiptReference!=='string'||!receiptReference.trim())throw Error('actual native identity and receipt reference required');
 const receipt={actorId,nativeTaskId,receiptReference,phase:'manual-dispatch-receipt',utc:new Date().toISOString(),intentSHA256:digest(readBounded(path.join(cellDir,'actor-dispatch-intent.json'))),verification:'coordinator supplied native tool receipt; procedural, not authenticated by this file'};
 write(path.join(cellDir,'actor-dispatch-receipt.json'),receipt);return receipt;
}
/** Required lineage prevents synthetic controls from silently becoming native result evidence. */
function nativeEvidence(cellDir,admission,expected){
 verifyCellNativeCompletionEvidence({cellDir,admission,supervision:readJSON(path.join(cellDir,'supervisor-result.json'))});
 const synthetic=admission.evidenceMode==='synthetic-control';
 if(synthetic){if(expected!==undefined&&expected!==null)throw Error('synthetic dispatch mismatch');if(fs.existsSync(path.join(cellDir,'actor-dispatch-receipt.json')))throw Error('synthetic control forbids actor dispatch receipt');if(!['orchestrate-off','orchestrate-on'].includes(admission.arm))return null;}
 if(!synthetic&&admission.evidenceMode!=='native-assignment')throw Error('unknown evidence mode');
 const checkRuntimeSHA256=verifyCellCheckRuntime({cellDir,admission,supervision:readJSON(path.join(cellDir,'supervisor-result.json'))});
 const assignment=readJSON(path.join(cellDir,'assignment.json')),intent=readJSON(path.join(cellDir,'actor-dispatch-intent.json')),receipt=synthetic?null:readJSON(path.join(cellDir,'actor-dispatch-receipt.json')),ready=readJSON(path.join(cellDir,'supervisor-ready.json'));
 const bootstrap=readCellBootstrapReceipt({cellDir});
 const actionReceipts=validateActionReceiptEvidence({cellDir,supervision:readJSON(path.join(cellDir,'supervisor-result.json'))});
 const hashes={checkRuntimeSHA256,actionReceipts,handoffSHA256:bootstrap.description.handoffSHA256,capabilitySHA256:bootstrap.description.capabilitySHA256,bootstrapReceiptSHA256:bootstrap.receiptSHA256,bootstrapAttemptSHA256:bootstrap.attemptSHA256,bootstrapOutputBytes:bootstrap.receipt.emittedOutput.bytes,bootstrapOutputSHA256:bootstrap.receipt.emittedOutput.sha256,supervisorSHA256:digest(readBounded(path.join(cellDir,'supervisor-result.json'))),intentSHA256:digest(readBounded(path.join(cellDir,'actor-dispatch-intent.json'))),...(synthetic?{}:{receiptSHA256:digest(readBounded(path.join(cellDir,'actor-dispatch-receipt.json'))),nativeTaskId:receipt.nativeTaskId,receiptReference:receipt.receiptReference})};
 if(intent.actorId!==assignment.actorId||(!synthetic&&(receipt.actorId!==assignment.actorId||typeof receipt.nativeTaskId!=='string'||!receipt.nativeTaskId.trim()||typeof receipt.receiptReference!=='string'||!receipt.receiptReference.trim()||receipt.intentSHA256!==hashes.intentSHA256))||intent.assignmentSHA256!==digest(readBounded(path.join(cellDir,'assignment.json')))||intent.readySHA256!==digest(readBounded(path.join(cellDir,'supervisor-ready.json')))||ready.admissionSHA256!==digest(readBounded(path.join(cellDir,'admission.json'))))throw Error('native dispatch lineage mismatch');
 const supervision=readJSON(path.join(cellDir,'supervisor-result.json')),start=readJSON(path.join(cellDir,'supervisor-start.json'));
 const observations=supervision.timing?.observations,acks=observations?.filter(e=>e.type==='coordinator-control-ack')??[],inputs=observations?.filter(e=>e.type==='actor-input-start')??[];
 if(intent.handoff?.handoffSHA256!==hashes.handoffSHA256||intent.handoff?.capabilitySHA256!==hashes.capabilitySHA256||supervision.bootstrap?.receiptSHA256!==hashes.bootstrapReceiptSHA256||supervision.bootstrap?.outputBytes!==hashes.bootstrapOutputBytes||supervision.bootstrap?.outputSHA256!==hashes.bootstrapOutputSHA256||acks[0]?.handoffSHA256!==hashes.handoffSHA256||acks[0]?.capabilitySHA256!==hashes.capabilitySHA256||inputs[0]?.bootstrapReceiptSHA256!==hashes.bootstrapReceiptSHA256)throw Error('native public bootstrap evidence mismatch');
 if(supervision.coordinatorControls!==1||acks.length!==1||inputs.length!==1||acks[0].intentSHA256!==hashes.intentSHA256||acks[0].actorId!==assignment.actorId||acks[0].assignmentSHA256!==intent.assignmentSHA256||inputs[0].actorId!==assignment.actorId||inputs[0].assignmentSHA256!==intent.assignmentSHA256||start.assignmentSHA256!==intent.assignmentSHA256||supervision.supervisorStartSHA256!==digest(readBounded(path.join(cellDir,'supervisor-start.json')))||ready.supervisorStartSHA256!==supervision.supervisorStartSHA256)throw Error('native dispatch acknowledgement missing or mismatched');
 if(![ready.monotonicMs,acks[0].monotonicMs,inputs[0].monotonicMs,start.deadlineMonotonicMs].every(Number.isFinite)||ready.monotonicMs>acks[0].monotonicMs||acks[0].monotonicMs>inputs[0].monotonicMs||inputs[0].monotonicMs>=start.deadlineMonotonicMs||observations.indexOf(acks[0])>=observations.indexOf(inputs[0]))throw Error('native dispatch ordering invalid');
 if(synthetic){if(intent.phase!=='synthetic-control-intent'||supervision.evidenceMode!=='synthetic-control'||supervision.outcome?.evidenceMode!=='synthetic-control')throw Error('synthetic transport evidence mode mismatch');return null;}
 if(expected!==undefined&&JSON.stringify(hashes)!==JSON.stringify(expected))throw Error('native dispatch evidence changed');
 return hashes;
}
