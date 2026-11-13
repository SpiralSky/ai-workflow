import {digest} from './protocol.mjs';

export const ROLE_BUDGET_LIMITS=Object.freeze({calls:256,bytes:2097152,resultBytes:1048576,callReserveBytes:8192});
const size=value=>Buffer.byteLength(JSON.stringify(value));
const clone=value=>JSON.parse(JSON.stringify(value));
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
const keys=value=>value&&typeof value==='object'&&!Array.isArray(value)?Object.keys(value).sort().join(','):'';
const READY='{"kind":"native-role-archive-ready","version":1}\n';
/** Coordinator-only initial usage includes all prior setup and parent calls. */
export function createRoleBudget(binding,used={calls:0,bytes:0}){
 if(keys(binding)!=='cellId,sourceSHA256'||! /^[a-z0-9-]{1,100}$/.test(binding.cellId)||! /^[a-f0-9]{64}$/.test(binding.sourceSHA256))throw Error('role budget binding');
 if(!Number.isSafeInteger(used.calls)||used.calls<0||used.calls>256||!Number.isSafeInteger(used.bytes)||used.bytes<0||used.bytes>2097152)throw Error('role budget usage');
 return {version:'native-role-budget-v1',binding:clone(binding),used:clone(used),status:'ready',generation:0,outstanding:null};
}
/** Validate fixed source-generated exec templates and associated data-only write policy.
 * Payload protocol validation remains mandatory in the unchanged source transport.
 */
function commandSpec(spec){
 if(keys(spec)!=='args,writePolicy'||keys(spec.args)!=='cmd,login,max_output_tokens,tty,yield_time_ms'||typeof spec.args.cmd!=='string'||spec.args.cmd.length>4096||spec.args.login!==false||typeof spec.args.tty!=='boolean'||![1000,30000].includes(spec.args.yield_time_ms)||![4096,131072].includes(spec.args.max_output_tokens))throw Error('role command template');
 if(spec.writePolicy!==null){const p=spec.writePolicy;if(keys(p)!=='maxBytes,max_output_tokens,payload,yield_time_ms'||!['empty','frame'].includes(p.payload)||!Number.isSafeInteger(p.maxBytes)||p.maxBytes<0||p.maxBytes>2097152||![1000,30000].includes(p.yield_time_ms)||![4096,131072].includes(p.max_output_tokens))throw Error('role write policy');}
}
/** Reserve one sequential remaining quota. Templates must come from reviewed source, never actors. */
export function reserveRoleBudget(state,{role,sequence,reservationId,sinkCommand,commands,externalSessions=[]}){
 if(state.status!=='ready'||state.outstanding)throw Error('role budget not available');
 try{
  if(!['assignment','completion','parent'].includes(role)||!Number.isInteger(sequence)||sequence<1||sequence>32||! /^[a-f0-9]{64}$/.test(reservationId))throw Error('role reservation identity');
  if(!Array.isArray(commands)||!commands.length||commands.length>16)throw Error('role commands');commands.forEach(commandSpec);
  if(new Set(commands.map(s=>s.args.cmd)).size!==commands.length||!commands.some(s=>s.args.cmd===sinkCommand&&s.writePolicy?.payload==='frame'))throw Error('role sink command');
  if(!Array.isArray(externalSessions)||externalSessions.length>1)throw Error('role external sessions');
  for(const e of externalSessions){if(keys(e)!=='owner,sessionId,writePolicy'||role!=='parent'||keys(e.owner)!=='identitySHA256,kind'||e.owner.kind!=='parent-supervisor'||! /^[a-f0-9]{64}$/.test(e.owner.identitySHA256)||!Number.isSafeInteger(e.sessionId)||e.sessionId<1)throw Error('role external session');commandSpec({args:commands[0].args,writePolicy:e.writePolicy});}
  const r={version:'native-role-reservation-v1',binding:clone(state.binding),generation:++state.generation,role,sequence,reservationId,sinkCommand,commands:clone(commands),externalSessions:clone(externalSessions),remaining:{calls:256-state.used.calls,bytes:2097152-state.used.bytes}};
  if(r.remaining.calls<2||r.remaining.bytes<1048576+8192)throw Error('role budget exhausted');
  state.status='reserved';state.outstanding=clone(r);return clone(r);
 }catch(error){state.status='stopped';throw error;}
}
/** Missing/uncertain settlement is irreversible. */
export function stopRoleBudget(state){state.status='stopped';}
/** Local state is private to one role and one exact reservation. */
export function createRoleRecorderState(reservation){return {reservation:clone(reservation),status:'active',rows:[],pending:null,sessions:reservation.externalSessions.map(e=>({...clone(e),external:true,live:true,origin:null})),seenSessions:reservation.externalSessions.map(e=>e.sessionId)};}
/** Reject all non-template arguments before any tool effect. */
function validateCall(local,{name,args},archive=false){
 const r=local.reservation;
 if(name==='exec_command'){const spec=r.commands.find(s=>same(s.args,args));if(!spec)throw Error('role command mismatch');return {spec};}
 if(name!=='write_stdin'||keys(args)!=='chars,max_output_tokens,session_id,yield_time_ms'||typeof args.chars!=='string')throw Error('role write schema');
 const session=local.sessions.find(s=>s.sessionId===args.session_id&&s.live);if(!session)throw Error('role session not live');
 if(archive){if(session.origin!==r.sinkCommand||args.yield_time_ms!==30000||args.max_output_tokens!==4096)throw Error('role archive arguments');}
 else{const p=session.writePolicy;if(!p||args.yield_time_ms!==p.yield_time_ms||args.max_output_tokens!==p.max_output_tokens||Buffer.byteLength(args.chars)>p.maxBytes||(p.payload==='empty'?args.chars!=='':args.chars!==''&&(!args.chars.endsWith('\n')||args.chars.slice(0,-1).includes('\n'))))throw Error('role write policy');}
 return {session};
}
/** Preserve original 1MiB+8192 pre-call reservation. There is no caller-selected smaller reserve.
 * Archival fit is checked separately after actual results, and can fail with incomplete evidence.
 */
export function checkRoleCallQuota(local,call){
 try{
  if(local.status!=='active'||local.pending)throw Error('role recorder unavailable');const context=validateCall(local,call);
  const sink=call.name==='exec_command'?call.args.cmd===local.reservation.sinkCommand:context.session.origin===local.reservation.sinkCommand;
  if(local.rows.length+(sink?2:3)>local.reservation.remaining.calls)throw Error('role call quota');
  const row={ordinal:local.rows.length+1,...clone(call)};
  if(size([...local.rows,row])+1048576+8192>local.reservation.remaining.bytes)throw Error('role byte quota');
  local.pending=row;return clone(row);
 }catch(error){local.status='stopped';throw error;}
}
/** Retain only an actually returned complete native result; unknown outcome must stop instead. */
export function recordRoleCallResult(local,result){
 try{
  if(local.status!=='active'||!local.pending)throw Error('role recorder unavailable');
  const call=local.pending,context=validateCall(local,call);
  if(!result||Object.keys(result).some(k=>!['output','wall_time_seconds','chunk_id','original_token_count','exit_code','session_id'].includes(k))||typeof result.output!=='string'||!Number.isFinite(result.wall_time_seconds)||result.wall_time_seconds<0||size(result)>1048576)throw Error('role tool result schema');
  const live=result.session_id!==undefined,terminal=result.exit_code!==undefined;
  if(live===terminal||(terminal&&result.exit_code!==0)||(live&&(!Number.isSafeInteger(result.session_id)||result.session_id<1)))throw Error('role tool result state');
  if(call.name==='exec_command'&&live){if(local.seenSessions.includes(result.session_id))throw Error('role session reused');local.seenSessions.push(result.session_id);local.sessions.push({sessionId:result.session_id,writePolicy:clone(context.spec.writePolicy),external:false,live:true,origin:call.args.cmd});}
  if(call.name==='write_stdin'){if(live&&result.session_id!==call.args.session_id)throw Error('role session changed');if(terminal)context.session.live=false;}
  const row={...call,result:clone(result)};if(size([...local.rows,row])>local.reservation.remaining.bytes)throw Error('role result quota');
  local.rows.push(row);local.pending=null;return clone(row);
 }catch(error){local.status='stopped';throw error;}
}
/** Freeze prefix after sink READY. Precharge exact final write arguments plus original result reserve.
 * Sink launch/polls are already in prefix. Returned args are the only permitted terminal call.
 */
export function prepareRoleArchive(local){
 try{
  if(local.status!=='active'||local.pending)throw Error('role recorder unavailable');
  const last=local.rows.at(-1),sink=local.sessions.find(s=>s.live&&s.origin===local.reservation.sinkCommand);
  if(!last||!sink||last.result.session_id!==sink.sessionId||last.result.output!==READY||local.sessions.some(s=>s.live&&!s.external&&s!==sink))throw Error('role archive closure');
  const prefixRaw=JSON.stringify({version:'native-role-prefix-v1',reservation:local.reservation,rows:local.rows})+'\n';
  const args={session_id:sink.sessionId,chars:prefixRaw,yield_time_ms:30000,max_output_tokens:4096};validateCall(local,{name:'write_stdin',args},true);
  if(local.rows.length+1>local.reservation.remaining.calls||Buffer.byteLength(prefixRaw)+size({name:'write_stdin',args})+1048576+8192>local.reservation.remaining.bytes)throw Error('role archival quota; incomplete evidence');
  local.status='archiving';return {prefixRaw,args};
 }catch(error){local.status='stopped';throw error;}
}
/** Parent replays validation only, never effects, and settles persisted bytes + actual terminal tail.
 * Final coordinator persistence is outside the explicitly finite self-recording boundary.
 */
export function settleRoleBudget(state,{reservation,prefixRaw,tail}){
 try{
  if(state.status!=='reserved'||!same(state.outstanding,reservation))throw Error('role settlement reservation');
  if(typeof prefixRaw!=='string'||Buffer.byteLength(prefixRaw)>reservation.remaining.bytes)throw Error('role prefix bytes');
  const prefix=JSON.parse(prefixRaw);if(keys(prefix)!=='reservation,rows,version'||prefix.version!=='native-role-prefix-v1'||!same(prefix.reservation,reservation)||!Array.isArray(prefix.rows))throw Error('role prefix binding');
  const local=createRoleRecorderState(reservation);
  for(const row of prefix.rows){if(keys(row)!=='args,name,ordinal,result'||row.ordinal!==local.rows.length+1)throw Error('role prefix row');checkRoleCallQuota(local,{name:row.name,args:row.args});recordRoleCallResult(local,row.result);}
  const prepared=prepareRoleArchive(local);if(prepared.prefixRaw!==prefixRaw||keys(tail)!=='args,name,result'||tail.name!=='write_stdin'||!same(tail.args,prepared.args))throw Error('role archive tail arguments');
  const expected=JSON.stringify({kind:'native-role-archive-saved',version:1,reservationId:reservation.reservationId,bytes:Buffer.byteLength(prefixRaw),sha256:digest(Buffer.from(prefixRaw))})+'\n';
  const r=tail.result;if(!r||Object.keys(r).some(k=>!['output','wall_time_seconds','chunk_id','original_token_count','exit_code','session_id'].includes(k))||size(r)>1048576||r.exit_code!==0||r.session_id!==undefined||r.output!==expected||!Number.isFinite(r.wall_time_seconds)||r.wall_time_seconds<0)throw Error('role archive terminal result');
  const usage={calls:prefix.rows.length+1,bytes:Buffer.byteLength(prefixRaw)+size(tail)};
  if(usage.calls>reservation.remaining.calls||usage.bytes>reservation.remaining.bytes)throw Error('role settlement quota');
  state.used.calls+=usage.calls;state.used.bytes+=usage.bytes;state.outstanding=null;state.status='ready';
  return {version:'native-role-settlement-v1',reservationId:reservation.reservationId,generation:reservation.generation,usage,totals:clone(state.used),prefixSHA256:digest(Buffer.from(prefixRaw)),tailSHA256:digest(tail),carriedSessions:clone(local.sessions.filter(s=>s.external).map(s=>({sessionId:s.sessionId,owner:s.owner,live:s.live}))),scope:'supplied complete prefix and actual terminal archive call; final coordinator persistence excluded; procedural provenance only'};
 }catch(error){state.status='stopped';throw error;}
}
