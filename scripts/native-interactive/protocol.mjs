import {createHash} from 'node:crypto';

export const PROTOCOL_VERSION='native-interactive-public-bootstrap-v2';
export const LIMITS = Object.freeze({assignmentMs:900000, actionMs:60000, rounds:12, hostCalls:60, lineBytes:98304, sourceBytes:32768, feedbackBytes:1048576});
/** Host monotonic observation; durations are derived only within the observing process. */
export const monotonicNow = () => Number(process.hrtime.bigint()) / 1e6;
export const ARMS = Object.freeze(['direct','branch-expanded','branch-hotpath2']);
/** Hash machine-observed payloads; this is not native conversation or billing provenance. */
export const digest = value => createHash('sha256').update(typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value)).digest('hex');
/** Validate one finite project action. No model/provider messages are accepted. */
export function parseAction(line, arm, expectedSequence) {
  if (!ARMS.includes(arm)) throw new Error('unavailable arm');
  if (Buffer.byteLength(line) > LIMITS.lineBytes) throw new Error('action too large');
  const a=JSON.parse(line);
  if (!a || typeof a!=='object' || Array.isArray(a) || a.sequence!==expectedSequence) throw new Error('invalid/replayed sequence');
  const keys=Object.keys(a).sort().join(',');
  if (a.kind==='submit' && keys==='kind,sequence') return a;
  if (arm==='direct' && a.kind==='tools' && keys==='calls,kind,sequence' && Array.isArray(a.calls) && a.calls.length>0 && a.calls.length<=LIMITS.hostCalls) {
    for(const call of a.calls) if(!call || Object.keys(call).sort().join(',')!=='args,name' || typeof call.name!=='string' || !call.args || typeof call.args!=='object' || Array.isArray(call.args)) throw new Error('invalid tool call');
    return a;
  }
  if((arm==='branch-expanded'||arm==='branch-hotpath2') && a.kind==='branch' && keys==='code,kind,sequence' && typeof a.code==='string' && Buffer.byteLength(a.code)<=LIMITS.sourceBytes) return a;
  throw new Error('invalid action');
}
/** Decode newline actions with a streaming byte ceiling, before JSON allocation. */
export async function* boundedLines(stream, max=LIMITS.lineBytes) {
  let pieces=[], bytes=0;
  for await (const input of stream) {
    const chunk=Buffer.isBuffer(input)?input:Buffer.from(input);
    let start=0;
    for(let i=0;i<chunk.length;i++) if(chunk[i]===10) {
      const piece=chunk.subarray(start,i); bytes+=piece.length;
      if(bytes>max) throw new Error('action too large');
      pieces.push(piece); const all=Buffer.concat(pieces);
      const text=new TextDecoder('utf-8',{fatal:true}).decode(all);
      yield text; pieces=[];bytes=0;start=i+1;
    }
    const tail=chunk.subarray(start);bytes+=tail.length;
    if(bytes>max) throw new Error('action too large');
    pieces.push(tail);
  }
  if(bytes) throw new Error('unterminated action');
}
/** Fail-closed session bookkeeping; reservation precedes effects and failures are sticky. */
const capture = value => {
 const copy=JSON.parse(JSON.stringify(value));
 const freeze=x=>{if(x && typeof x==='object'){for(const v of Object.values(x))freeze(v);Object.freeze(x);}return x;};
 return freeze(copy);
};
export class Ledger {
  #events=[];
  get events() {return Object.freeze([...this.#events]);}
  constructor(arm) { if(!ARMS.includes(arm)) throw new Error('unavailable arm'); this.arm=arm;this.sequence=1;this.calls=0;this.feedback=0;this.state='open'; }
  reserve(line) {
    if(this.state!=='open') throw new Error('session closed');
    try {
      if(this.sequence>LIMITS.rounds) throw new Error('round limit');
      const a=parseAction(line,this.arm,this.sequence);
      if(this.sequence===LIMITS.rounds && a.kind!=='submit') throw new Error('final round reserved for submit');
      this.sequence++;
      this.state='pending';this.#events.push(capture({type:'reserved',action:a}));return a;
    } catch(e) {this.fail(e.message);throw e;}
  }
  hostAttempt(name,args) {
    if(this.state!=='pending') throw new Error('no pending action');
    if(++this.calls>LIMITS.hostCalls) {this.fail('host call limit');throw new Error('host call limit');}
    try {this.#events.push(capture({type:'host-attempt',name,args}));} catch(e) {this.fail('unrecordable host arguments');throw e;}
  }
  finish(result, submitted=false) {
    if(this.state!=='pending') throw new Error('no pending action');
    let encoded;try {encoded=JSON.stringify(result);if(typeof encoded!=='string')throw new Error('unrecordable result');} catch(e) {this.fail('unrecordable result');throw e;}
    this.feedback+=Buffer.byteLength(encoded);
    if(this.feedback>LIMITS.feedbackBytes) {this.fail('feedback limit');throw new Error('feedback limit');}
    try {this.#events.push(capture({type:'result',result:JSON.parse(encoded)}));}
    catch(e) {this.fail('unrecordable result');throw e;}
    this.state=submitted?'submitted':'open';
  }
  fail(reason) {this.state='failed';this.#events.push(capture({type:'failure',reason:String(reason)}));}
}
