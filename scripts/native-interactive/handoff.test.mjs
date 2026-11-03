import test from 'node:test';
import assert from 'node:assert/strict';
import {digest,PROTOCOL_VERSION} from './protocol.mjs';
import {HANDOFF_LIMITS, PUBLIC_HANDOFF_TEMPLATE, generatePublicHandoff, verifyPublicHandoff, parsePublicHandoff} from './handoff.mjs';

const bindings = {cellDir:'/tmp/synthetic-campaign/cell-one',cellId:'cell-one',cellIndex:0,fixtureId:'calendar-window',arm:'direct',campaignSHA256:digest('synthetic campaign'),sourceBindingSHA256:digest('source'),assignmentSHA256:digest('assignment'),admissionSHA256:digest('admission'),protocolSHA256:digest('protocol')};
/** Build a public source with intentionally noncanonical JSON spacing and key order. */
function sources(text='Repair café and 🐢.\n') {
  const task = Buffer.from(text);
  const readyFrame = Buffer.from('{ "packet": {"tools":[],"allowedWritePaths":["window.py","tests/test_regressions.py"],"fingerprint":{"promptHash":"a","toolsHash":"b"},"task":'+JSON.stringify(text)+',"instructions":"Use actual tools."}, "kind": "ready" }\n');
  return {task,readyFrame,bindings};
}

test('preserves public task and raw UTF-8 ready bytes including newline without reserialization', () => {
  const input = sources(), {payload,manifest} = generatePublicHandoff(input);
  assert.deepEqual(verifyPublicHandoff({...input,payload,manifest}),manifest);
  const parsed=parsePublicHandoff({payload,manifest,bindings});assert.deepEqual(parsed.task,input.task);assert.deepEqual(parsed.readyFrame,input.readyFrame);
  assert.equal(parsed.readyFrame.at(-1),10);assert.notEqual(manifest.task.bytes,input.task.toString().length);
});

test('public payload consists only of fixed template, exact public sources and framing', () => {
  const input=sources(), {payload,manifest}=generatePublicHandoff(input), parsed=parsePublicHandoff({payload,manifest,bindings});
  assert.deepEqual(parsed.task,input.task);assert.deepEqual(parsed.readyFrame,input.readyFrame);
  assert.equal(payload.subarray(0,manifest.template.bytes).toString(),PUBLIC_HANDOFF_TEMPLATE);
  assert.equal(manifest.payload.bytes,payload.length);assert.equal(manifest.task.bytes,input.task.length);assert.equal(manifest.readyFrame.bytes,input.readyFrame.length);
  assert.equal(manifest.readyFrame.sha256,digest(input.readyFrame));assert.equal(payload.includes(Buffer.from(bindings.cellDir)),false);
  assert.equal(payload.includes(Buffer.from(bindings.assignmentSHA256)),false);
  const other=generatePublicHandoff({...input,bindings:{...bindings,arm:'branch-hotpath2'}});
  assert.deepEqual(other.payload,payload);assert.deepEqual(other.manifest.template,manifest.template);
});

test('rejects payload edits, extra suffixes, reordered sections and raw ready reserialization', () => {
  const input=sources(), {payload,manifest}=generatePublicHandoff(input);
  for(const altered of [Buffer.concat([payload,Buffer.from('\n')]),payload.subarray(0,-1),Buffer.concat([input.readyFrame,input.task]),Buffer.from(payload.toString().replace('café','cafe'))]) assert.throws(()=>verifyPublicHandoff({...input,payload:altered,manifest}),/mismatch/);
  const reserialized=Buffer.from(JSON.stringify(JSON.parse(input.readyFrame))+'\n');
  assert.throws(()=>verifyPublicHandoff({...input,readyFrame:reserialized,payload,manifest}),/mismatch/);
});

test('rejects changed identity, hashes, byte counts, offsets and extra metadata', () => {
  const input=sources(), {payload,manifest}=generatePublicHandoff(input);
  for(const change of [m=>m.payload.bytes++,m=>m.task.offset++,m=>m.readyFrame.sha256=digest('wrong'),m=>m.template.sha256=digest('wrong'),m=>m.extra='secret',m=>m.bindings.campaignSHA256=digest('other')]) {
    const altered=structuredClone(manifest);change(altered);assert.throws(()=>parsePublicHandoff({payload,manifest:altered,bindings}));
  }
  assert.throws(()=>generatePublicHandoff({...input,bindings:{...bindings,extra:'secret'}}));
  assert.throws(()=>generatePublicHandoff({...input,bindings:{...bindings,cellIndex:-1}}));
  assert.throws(()=>generatePublicHandoff({...input,bindings:{...bindings,cellDir:'/tmp/campaign/../cell-one'}}));
});

test('rejects malformed, unterminated, multiline or mismatching public ready bytes', () => {
  const input=sources();
  for(const readyFrame of [input.readyFrame.subarray(0,-1),Buffer.concat([input.readyFrame,Buffer.from('\n')]),Buffer.from('{}\n'),Buffer.from('{"kind":"ready","packet":{}}\n'),Buffer.concat([Buffer.from([255]),input.readyFrame])]) assert.throws(()=>generatePublicHandoff({...input,readyFrame}));
  assert.throws(()=>generatePublicHandoff({...input,task:Buffer.from('another task')}));
  assert.throws(()=>generatePublicHandoff({...input,task:Buffer.from([255])}));
  const extra=JSON.parse(input.readyFrame);extra.packet.privateMetadata='not public';
  assert.throws(()=>generatePublicHandoff({...input,readyFrame:Buffer.from(JSON.stringify(extra)+'\n')}),/nonpublic/);
});

test('enforces independent source limits and counts duplicated task bytes', () => {
  const input=sources('x'.repeat(HANDOFF_LIMITS.taskBytes));
  const base=JSON.parse(input.readyFrame);base.packet.instructions='';
  const empty=Buffer.from(JSON.stringify(base)+'\n');base.packet.instructions=' '.repeat(HANDOFF_LIMITS.readyBytes-empty.length);
  const readyFrame=Buffer.from(JSON.stringify(base)+'\n'), {payload,manifest}=generatePublicHandoff({...input,readyFrame});
  assert.equal(readyFrame.length,HANDOFF_LIMITS.readyBytes);assert.equal(manifest.task.bytes,32768);assert.equal(manifest.readyFrame.bytes,98304);
  assert.ok(payload.length>=32768+98304);assert.ok(payload.length<=HANDOFF_LIMITS.payloadBytes);
  assert.throws(()=>generatePublicHandoff(sources('x'.repeat(HANDOFF_LIMITS.taskBytes+1))),/task bytes/);
  assert.throws(()=>generatePublicHandoff({...input,readyFrame:Buffer.concat([Buffer.from(' '),readyFrame])}),/ready frame/);
});

 test('requires an explicit canonical duplicate-free allowed write list in public ready',()=>{
  const input=sources();
  for(const allowedWritePaths of [undefined,null,{},'window.py',[''],['/window.py'],['..'],['.'],['a/../b'],['a/./b'],['a//b'],['a/'],['a\\b'],['a\0b'],['window.py','window.py'],[42]]){
    const ready=JSON.parse(input.readyFrame);ready.packet.allowedWritePaths=allowedWritePaths;
    assert.throws(()=>generatePublicHandoff({...input,readyFrame:Buffer.from(JSON.stringify(ready)+'\n')}),/allowed write paths/);
  }
  for(const allowedWritePaths of [[],['window.py','tests/test_regressions.py'],['résumé.py']]){
    const ready=JSON.parse(input.readyFrame);ready.packet.allowedWritePaths=allowedWritePaths;
    const readyFrame=Buffer.from(JSON.stringify(ready)+'\n'),generated=generatePublicHandoff({...input,readyFrame});
    assert.deepEqual(parsePublicHandoff({...generated,bindings}).readyFrame,readyFrame);
  }
 });


test('v2 common template fixes one-action turns and same-actor continuation without polling',()=>{
  assert.equal(PROTOCOL_VERSION,'native-interactive-action-receipt-v3');
  assert.ok(PUBLIC_HANDOFF_TEMPLATE.startsWith('PUBLIC NATIVE ASSIGNMENT PROTOCOL v2\n'));
  for(const exact of [
    'Send exactly one JSON action line per turn',
    'immediately END the current turn with exactly "Awaiting coordinator feedback." as the final response.',
    'do not repeat the JSON in it.',
    'Do not keep sampling, poll, call a wait tool, or send another action in that turn.',
    'observes the ended/completed turn, executes that action exactly once',
    'resumes this SAME actor with collaboration.followup_task containing actual complete feedback.',
    'use the existing conversation context and prior sequence',
    'Do not start a new actor per action or repeat the bootstrap.',
    'Terminal submit follows the same send-and-end rule with the same fixed final response; do not send another action after submit.'
  ])assert.ok(PUBLIC_HANDOFF_TEMPLATE.includes(exact),exact);
  assert.ok(!PUBLIC_HANDOFF_TEMPLATE.includes('Wait for coordinator feedback'));
});
