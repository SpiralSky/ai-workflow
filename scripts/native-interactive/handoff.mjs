import path from 'node:path';
import {digest, LIMITS, ARMS} from './protocol.mjs';

export const HANDOFF_LIMITS = Object.freeze({taskBytes:32768, readyBytes:LIMITS.lineBytes, payloadBytes:32768+LIMITS.lineBytes+16384, metadataBytes:16384});

// Draft text: the same bytes apply to every arm. Deployment still requires root approval.
export const PUBLIC_HANDOFF_TEMPLATE = `PUBLIC NATIVE ASSIGNMENT PROTOCOL v2
This is one finite native coding assignment. Solve the complete public TASK below using only the public ready packet and actual coordinator-relayed feedback. The TASK is also present inside the ready packet by design; both copies count toward the visible input bytes.
The common limit is 900 seconds from supervisor launch through close, including setup, bootstrap, assignment, idle time, relay, actions, and cleanup. Each action has a 60-second ceiling within that same deadline. There are at most 12 sequential action rounds, including the final submit round, and 60 total host-call attempts including failed attempts. Round 12 is reserved for submit. These limits are identical across arms and do not restart when this handoff is read.
Use the exact framework instructions and tool schemas in the ready packet. The sanctioned project tools are readFile, writeFile, edit, grep, findFiles, listDir, multiEdit, findDefinition, findReferences, check, and runTests, exposed directly or through the advertised branch tool. Use only relative canonical paths inside the fixture workspace. Write only paths in the exact allowedWritePaths list supplied in the public ready packet and enforced by the session; do not modify any other file.
After this one bootstrap invocation, the only permitted native-tool action is collaboration.send_message to the fixed coordinator target named in the initial bootstrap message, solely for the required action messages or an incomplete-status report. Do not use shell, general filesystem access, network access, any other native tools, other agents, models, providers, Codex, installs, or hidden/reference material. Do not inspect coordinator files or other cells. The bootstrap is the sole exception for reading this frozen public handoff through the supplied fixed helper command. It is not permission to read an arbitrary file or run another command.
Send exactly one JSON action line per turn to the coordinator, beginning at sequence 1 and increasing by one. After sending the action, immediately END the current turn with exactly "Awaiting coordinator feedback." as the final response. This fixed final response is not an action; do not repeat the JSON in it. Do not keep sampling, poll, call a wait tool, or send another action in that turn. The coordinator observes the ended/completed turn, executes that action exactly once, and resumes this SAME actor with collaboration.followup_task containing actual complete feedback. On that resumed turn, use the existing conversation context and prior sequence, then choose and send the next action and end again. Do not start a new actor per action or repeat the bootstrap. Direct actions use {"sequence":1,"kind":"tools","calls":[{"name":"advertised tool name","args":{}}]}; branch actions use {"sequence":1,"kind":"branch","code":"branch source"}. Match the tools advertised in the ready packet. Finish with {"sequence":N,"kind":"submit"} using the next sequence, no later than round 12. Terminal submit follows the same send-and-end rule with the same fixed final response; do not send another action after submit. Do not fabricate feedback, send concurrent actions, or use prose as an action or retry.
The fixed bootstrap emits the exact public TASK bytes and the entire original UTF-8 ready JSON line, including its newline. It reports actual byte counts and a terminal PUBLIC_BOOTSTRAP_END marker whose bodySHA256 covers every preceding output byte and whose outputBytes includes the terminal marker. No native tool output capacity is assumed or increased. If the tool reports truncation, any bytes or the terminal marker are missing, the counts/hashes do not match, or bootstrap fails, stop and report the incomplete handoff to the coordinator. Do not retry the bootstrap or reconstruct missing text.
A bootstrap receipt only records a local emission callback acknowledgement. It is not proof of transport delivery, model consumption, actor identity, hostile-actor isolation, task success, or billing/token usage.
`;

const BINDING_KEYS = ['admissionSHA256','arm','assignmentSHA256','campaignSHA256','cellDir','cellId','cellIndex','fixtureId','protocolSHA256','sourceBindingSHA256'];
/** Require exactly the documented object keys, without permitting an extra metadata channel. */
export function exactKeys(value, keys, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...keys].sort().join(',')) throw Error(`invalid ${label} keys`);
}
/** Validate lexical canonicality only; filesystem validation belongs to the fixed bootstrap. */
export function validateHandoffBindings(bindings) {
  exactKeys(bindings, BINDING_KEYS, 'handoff bindings');
  const {cellDir} = bindings;
  if (typeof cellDir !== 'string' || cellDir.includes('\0') || cellDir.includes('\\') || !path.isAbsolute(cellDir) || path.resolve(cellDir) !== cellDir || cellDir === path.parse(cellDir).root) throw Error('invalid canonical cell directory');
  if (!Number.isSafeInteger(bindings.cellIndex) || bindings.cellIndex < 0 || !ARMS.includes(bindings.arm) || typeof bindings.cellId !== 'string' || typeof bindings.fixtureId !== 'string' || !/^[a-z0-9-]+$/.test(bindings.cellId) || !/^[a-z0-9-]+$/.test(bindings.fixtureId) || path.basename(cellDir) !== bindings.cellId) throw Error('invalid campaign cell identity');
  for (const key of BINDING_KEYS.filter(key => key.endsWith('SHA256'))) if (typeof bindings[key] !== 'string' || !/^[a-f0-9]{64}$/.test(bindings[key])) throw Error(`invalid ${key}`);
  return Object.fromEntries(BINDING_KEYS.map(key => [key, bindings[key]]));
}
/** Decode UTF-8 strictly without discarding a possible byte-order mark. */
function decode(bytes) { return new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes); }
/** Validate source buffers before constructing any payload or trusting declared sizes. */
function validatePublicSources(task, readyFrame) {
  if (!Buffer.isBuffer(task) || !task.length || task.length > HANDOFF_LIMITS.taskBytes) throw Error('invalid public task bytes');
  if (!Buffer.isBuffer(readyFrame) || !readyFrame.length || readyFrame.length > HANDOFF_LIMITS.readyBytes || readyFrame.at(-1) !== 10 || readyFrame.indexOf(10) !== readyFrame.length-1) throw Error('invalid raw ready frame');
  const taskText = decode(task), ready = JSON.parse(decode(readyFrame));
  exactKeys(ready, ['kind','packet'], 'ready frame');
  if (ready.kind !== 'ready' || !ready.packet || typeof ready.packet !== 'object' || Array.isArray(ready.packet) || ready.packet.task !== taskText) throw Error('public task/ready mismatch');
  if (Object.keys(ready.packet).some(key => !['task','instructions','tools','fingerprint','hotpathExamples','allowedWritePaths'].includes(key))) throw Error('nonpublic ready field');
  const allowedWritePaths = ready.packet.allowedWritePaths;
  if (!Array.isArray(allowedWritePaths) || allowedWritePaths.some(value => typeof value !== 'string' || !value || value.includes('\\') || value.includes('\0') || path.posix.isAbsolute(value) || value.split('/').some(part => !part || part === '.' || part === '..')) || new Set(allowedWritePaths).size !== allowedWritePaths.length) throw Error('invalid public allowed write paths');
  if (typeof ready.packet.instructions !== 'string' || !Array.isArray(ready.packet.tools) || !ready.packet.fingerprint || typeof ready.packet.fingerprint !== 'object' || Array.isArray(ready.packet.fingerprint)) throw Error('incomplete public ready packet');
}
/** Generate public bytes without reserializing, normalizing, or paraphrasing either source. */
export function generatePublicHandoff({task, readyFrame, bindings}) {
  const identity = validateHandoffBindings(bindings);
  validatePublicSources(task, readyFrame);
  const template = Buffer.from(PUBLIC_HANDOFF_TEMPLATE);
  const taskHeader = Buffer.from(`\nPUBLIC_TASK_BEGIN bytes=${task.length} sha256=${digest(task)}\n`);
  const readyHeader = Buffer.from(`\nPUBLIC_TASK_END\nPUBLIC_READY_FRAME_BEGIN bytes=${readyFrame.length} sha256=${digest(readyFrame)}\n`);
  const end = Buffer.from('PUBLIC_READY_FRAME_END\n');
  const taskOffset = template.length + taskHeader.length, readyOffset = taskOffset + task.length + readyHeader.length;
  const payload = Buffer.concat([template, taskHeader, task, readyHeader, readyFrame, end]);
  if (payload.length > HANDOFF_LIMITS.payloadBytes) throw Error('public handoff byte limit');
  const manifest = {version:1, kind:'public-handoff', bindings:identity, cellSHA256:digest(identity.cellDir), template:{bytes:template.length, sha256:digest(template)}, task:{bytes:task.length, sha256:digest(task), offset:taskOffset}, readyFrame:{bytes:readyFrame.length, sha256:digest(readyFrame), offset:readyOffset}, payload:{bytes:payload.length, sha256:digest(payload)}};
  return {payload, manifest};
}
/** Fail closed on any identity, framing, byte, size, hash, or template change. */
export function verifyPublicHandoff({payload, task, readyFrame, manifest, bindings}) {
  if (!Buffer.isBuffer(payload) || payload.length > HANDOFF_LIMITS.payloadBytes) throw Error('invalid public handoff bytes');
  const expected = generatePublicHandoff({task, readyFrame, bindings});
  if (!payload.equals(expected.payload) || JSON.stringify(manifest) !== JSON.stringify(expected.manifest)) throw Error('public handoff mismatch');
  return expected.manifest;
}
/** Extract only manifest-bounded slices, then verify the complete deterministic payload. */
export function parsePublicHandoff({payload, manifest, bindings}) {
  if (!Buffer.isBuffer(payload) || payload.length > HANDOFF_LIMITS.payloadBytes) throw Error('invalid public handoff bytes');
  for (const [name, max] of [['task',HANDOFF_LIMITS.taskBytes], ['readyFrame',HANDOFF_LIMITS.readyBytes]]) {
    const section = manifest?.[name];
    if (!section || !Number.isSafeInteger(section.offset) || section.offset < 0 || !Number.isSafeInteger(section.bytes) || section.bytes <= 0 || section.bytes > max || section.offset+section.bytes > payload.length) throw Error('invalid public handoff section');
  }
  const task = Buffer.from(payload.subarray(manifest.task.offset, manifest.task.offset+manifest.task.bytes));
  const readyFrame = Buffer.from(payload.subarray(manifest.readyFrame.offset, manifest.readyFrame.offset+manifest.readyFrame.bytes));
  verifyPublicHandoff({payload, task, readyFrame, manifest, bindings});
  return {task, readyFrame};
}
