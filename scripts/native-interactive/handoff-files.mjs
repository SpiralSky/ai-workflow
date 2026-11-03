import fs from 'node:fs';
import path from 'node:path';
import {digest,LIMITS,PROTOCOL_VERSION} from './protocol.mjs';
import {readBounded} from './files.mjs';
import {generatePublicHandoff,verifyPublicHandoff,HANDOFF_LIMITS,PUBLIC_HANDOFF_TEMPLATE} from './handoff.mjs';
import {generateBootstrapCapability,formatBootstrapOutput,verifyBootstrapReceipt} from './bootstrap.mjs';
const REPO=path.resolve(import.meta.dirname,'../..');
const json=(file,max=1048576)=>JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readBounded(file,max)));
/** Exclusive metadata/public-byte persistence, never an upload or actor dispatch. */
function write(file,bytes){const fd=fs.openSync(file,'wx',0o600);try{fs.writeFileSync(fd,bytes);fs.fsyncSync(fd);}finally{fs.closeSync(fd);}}
/** Policy frozen in admission and campaign; all arms use the identical template. */
export function publicHandoffPolicy(){return {protocolVersion:PROTOCOL_VERSION,limits:HANDOFF_LIMITS,templateSHA256:digest(PUBLIC_HANDOFF_TEMPLATE),readyFraming:'utf8-json-line-including-lf',evidenceScope:'helper file validation and stdout acknowledgement, not actor consumption'};}
/** Resolve only the fixed cell and its canonical campaign ancestor; do not accept arbitrary files. */
function inputs(cellDir){
 if(!path.isAbsolute(cellDir)||path.resolve(cellDir)!==cellDir||fs.realpathSync(cellDir)!==cellDir)throw Error('canonical handoff cell required');
 const admissionBytes=readBounded(path.join(cellDir,'admission.json')),assignmentBytes=readBounded(path.join(cellDir,'assignment.json'),16384);
 const admission=JSON.parse(admissionBytes.toString('utf8')),assignment=JSON.parse(assignmentBytes.toString('utf8')),config=json(path.join(cellDir,'config.json'),16384);
 const campaignDir=path.dirname(cellDir),campaignBytes=readBounded(path.join(campaignDir,'campaign.json')),campaign=JSON.parse(campaignBytes.toString('utf8'));
 const cell=Number.isSafeInteger(assignment.index)&&assignment.index>=0?campaign.cells?.[assignment.index]:undefined;
 if(admission.evidenceMode!=='native-assignment'||campaign.evidenceMode!=='native-assignment'||assignment.campaignSHA256!==digest(campaignBytes)||!cell||cell.id!==path.basename(cellDir)||cell.fixtureId!==admission.fixtureId||cell.arm!==admission.arm||config.arm!==cell.arm||config.cellDir!==cellDir||JSON.stringify(config)!==JSON.stringify(admission.config))throw Error('native handoff campaign lineage mismatch');
 if(JSON.stringify(campaign.bindings)!==JSON.stringify(admission.bindings)||JSON.stringify(campaign.limits)!==JSON.stringify(LIMITS)||JSON.stringify(campaign.publicHandoffPolicy)!==JSON.stringify(publicHandoffPolicy())||JSON.stringify(admission.publicHandoffPolicy)!==JSON.stringify(publicHandoffPolicy()))throw Error('native handoff source or policy mismatch');
 const task=readBounded(path.join(cellDir,'TASK.md'),HANDOFF_LIMITS.taskBytes),readyFrame=readBounded(path.join(cellDir,'ready-frame.jsonl'),LIMITS.lineBytes),ready=json(path.join(cellDir,'supervisor-ready.json'),16384);
 const packet=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(readyFrame)).packet;if(JSON.stringify(packet?.allowedWritePaths)!==JSON.stringify(config.allowedWritePaths))throw Error('public write permissions changed');
 if(digest(task)!==admission.taskSHA256||ready.readyFraming!=='utf8-json-line-including-lf'||ready.readySHA256!==digest(readyFrame)||ready.readyFrameBytes!==readyFrame.length||ready.assignmentSHA256!==digest(assignmentBytes)||ready.admissionSHA256!==digest(admissionBytes)||ready.configSHA256!==digest(readBounded(path.join(cellDir,'config.json'),16384)))throw Error('public task or exact ready frame changed');
 const protocolPath='scripts/native-interactive/protocol.mjs',protocolSHA256=digest(readBounded(path.join(REPO,protocolPath)));
 if(admission.bindings?.[protocolPath]!==protocolSHA256)throw Error('handoff protocol source changed');
 const bindings={cellDir,sourceBindingSHA256:digest(admission.bindings),assignmentSHA256:digest(assignmentBytes),admissionSHA256:digest(admissionBytes),protocolSHA256,campaignSHA256:digest(campaignBytes),cellIndex:assignment.index,cellId:cell.id,fixtureId:cell.fixtureId,arm:cell.arm};
 return {admission,assignment,ready,task,readyFrame,bindings};
}
/** Prepare the one intended public artifact after ready and before dispatch intent. */
export function prepareCellPublicHandoff({cellDir}){
 const source=inputs(cellDir),{payload,manifest}=generatePublicHandoff(source),manifestBytes=Buffer.from(JSON.stringify(manifest)+'\n');
 const generated=generateBootstrapCapability({cellDir,manifest,manifestBytes});
 for(const name of ['public-handoff.txt','public-handoff.json','public-bootstrap.json','public-bootstrap-attempt.json','public-bootstrap-receipt.json','actor-dispatch-intent.json'])if(fs.existsSync(path.join(cellDir,name)))throw Error('public handoff already attempted');
 write(path.join(cellDir,'public-handoff.txt'),payload);write(path.join(cellDir,'public-handoff.json'),manifestBytes);write(path.join(cellDir,'public-bootstrap.json'),generated.bytes);
 return describe(readCellPublicHandoff({cellDir}));
}
/** Independently reconstruct exact public bytes and frozen capability before admission/use. */
export function readCellPublicHandoff({cellDir}){
 const source=inputs(cellDir),payload=readBounded(path.join(cellDir,'public-handoff.txt'),HANDOFF_LIMITS.payloadBytes),manifestBytes=readBounded(path.join(cellDir,'public-handoff.json'),16384),manifest=JSON.parse(manifestBytes.toString('utf8'));
 verifyPublicHandoff({...source,payload,manifest});
 const capabilityBytes=readBounded(path.join(cellDir,'public-bootstrap.json'),32768),generated=generateBootstrapCapability({cellDir,manifest,manifestBytes});
 if(!capabilityBytes.equals(generated.bytes))throw Error('public bootstrap capability changed');
 return {...source,payload,manifest,manifestBytes,capability:generated.capability,capabilityBytes,capabilitySHA256:generated.sha256,handoffSHA256:manifest.payload.sha256};
}
/** Metadata for the fixed bootstrap command; it does not attest a native message was delivered. */
function describe(data){
 const output=formatBootstrapOutput({payload:data.payload,manifest:data.manifest,capabilitySHA256:data.capabilitySHA256});
 const capabilityPath=path.join(data.bindings.cellDir,'public-bootstrap.json'),quote=value=>"'"+value.replace(/'/g,"'\"'\"'")+"'";
 const bootstrapCommand=[process.execPath,path.join(REPO,'scripts/native-interactive/bootstrap.mjs'),capabilityPath,data.capabilitySHA256].map(quote).join(' ');
 const bootstrapInstruction=`Coordinator: /root/restore_development_branch. Run exactly the fixed command below once through exec_command, requesting yield_time_ms=30000 and max_output_tokens=${output.length}. The tool capacity is unknown. If the single call is rejected, nonterminal, session-only, truncated, failed, incomplete, or missing the complete PUBLIC_BOOTSTRAP_END marker, report incomplete to the coordinator via collaboration.send_message and END the turn. Do not poll, call write_stdin, repeat exec_command, or use another reader. Expected public handoff SHA256: ${data.handoffSHA256}. After this one bootstrap, use only the coordinator relay described in its output; no other shell or filesystem access.\n${bootstrapCommand}\n`;
 return {bootstrapCommand,bootstrapInstruction,requestedOutputTokens:output.length,cellDir:data.bindings.cellDir,handoffSHA256:data.handoffSHA256,handoffBytes:data.payload.length,capabilitySHA256:data.capabilitySHA256,capabilityPath:path.join(data.bindings.cellDir,'public-bootstrap.json'),manifestSHA256:digest(data.manifestBytes),expectedBootstrapOutputBytes:output.length,expectedBootstrapOutputSHA256:digest(output),templateSHA256:data.manifest.template.sha256,taskSHA256:data.manifest.task.sha256,readySHA256:data.manifest.readyFrame.sha256,bindings:data.manifest.bindings,evidenceScope:'verified intended artifact; actual helper output and tool truncation are separate'};
}
export function verifyCellPublicHandoff(options){return describe(readCellPublicHandoff(options));}
/** Successful one-shot helper emission is necessary, never proof of model consumption. */
export function readCellBootstrapReceipt({cellDir}){
 const data=readCellPublicHandoff({cellDir}),attemptBytes=readBounded(path.join(cellDir,'public-bootstrap-attempt.json'),32768),receiptBytes=readBounded(path.join(cellDir,'public-bootstrap-receipt.json'),32768),receipt=JSON.parse(receiptBytes.toString('utf8'));
 verifyBootstrapReceipt({receipt,manifest:data.manifest,capability:data.capability,capabilitySHA256:data.capabilitySHA256,payload:data.payload,dispatchIntentSHA256:digest(readBounded(path.join(cellDir,'actor-dispatch-intent.json'),32768))});
 if(receipt.status!=='emitted'||receipt.attemptSHA256!==digest(attemptBytes))throw Error('public bootstrap incomplete or changed');
 return {description:describe(data),receipt,receiptSHA256:digest(receiptBytes),attemptSHA256:digest(attemptBytes)};
}
