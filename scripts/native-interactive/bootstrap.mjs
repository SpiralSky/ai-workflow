import fs from 'node:fs';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {digest, LIMITS, monotonicNow} from './protocol.mjs';
import {HANDOFF_LIMITS, exactKeys, parsePublicHandoff, validateHandoffBindings} from './handoff.mjs';

const CLOCK = Object.freeze({now:monotonicNow, setTimeout, clearTimeout});
const CAPABILITY_KEYS = ['version','kind','cellDir','handoffPath','manifestPath','manifestBytes','manifestSHA256','manifest'];
const SCOPE = 'local full-output callback acknowledgement only; not transport delivery, model consumption, actor authentication, hostile-actor isolation, task success, or billing evidence';
/** Encode coordinator-owned metadata consistently; raw public sources never use this function. */
function encode(value) { return Buffer.from(JSON.stringify(value, null, 2)+'\n'); }
/** Strict UTF-8 JSON metadata decoding. */
function decodeJSON(bytes) { return JSON.parse(new TextDecoder('utf-8', {fatal:true, ignoreBOM:true}).decode(bytes)); }
/** Reject aliases and symlinked ancestors. This is not an atomic hostile-ancestor-race defense. */
function canonicalDirectory(cellDir) {
  if (typeof cellDir !== 'string' || !path.isAbsolute(cellDir) || path.resolve(cellDir) !== cellDir || fs.realpathSync(cellDir) !== cellDir || !fs.lstatSync(cellDir).isDirectory()) throw Error('noncanonical cell directory');
}
/** Compare the metadata relevant to a stable, single-link regular-file read. */
function stable(a, b) {
  return a.isFile() && b.isFile() && a.nlink === 1 && b.nlink === 1 && ['dev','ino','size','mode','mtimeMs','ctimeMs'].every(key => a[key] === b[key]);
}
/** One bounded no-follow read of an exact canonical regular file, with before/after checks. */
function readFixed(file, maxBytes) {
  if (!path.isAbsolute(file) || path.resolve(file) !== file || fs.realpathSync(file) !== file) throw Error('noncanonical bootstrap file');
  const before = fs.lstatSync(file);
  if (!before.isFile() || before.nlink !== 1 || before.size > maxBytes) throw Error('unsafe or oversized bootstrap file');
  const fd = fs.openSync(file, fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try {
    if (!stable(before, fs.fstatSync(fd))) throw Error('unstable bootstrap file');
    const buffer = Buffer.alloc(before.size+1); let used = 0;
    while (used < buffer.length) { const n = fs.readSync(fd, buffer, used, buffer.length-used, null); if (!n) break; used += n; }
    if (used !== before.size || !stable(before, fs.fstatSync(fd)) || !stable(before, fs.lstatSync(file)) || fs.realpathSync(file) !== file) throw Error('unstable bootstrap file');
    return buffer.subarray(0, used);
  } finally { fs.closeSync(fd); }
}
/** Persist once, synchronously, before the dependent effect. Existing files are never replaced. */
function exclusive(file, bytes) {
  canonicalDirectory(path.dirname(file));
  const fd = fs.openSync(file, fs.constants.O_WRONLY|fs.constants.O_CREAT|fs.constants.O_EXCL|fs.constants.O_NOFOLLOW, 0o600);
  try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
  const directory = fs.openSync(path.dirname(file), fs.constants.O_RDONLY|fs.constants.O_DIRECTORY|fs.constants.O_NOFOLLOW);
  try { fs.fsyncSync(directory); } finally { fs.closeSync(directory); }
}
/** Construct a fixed-path capability for already generated, coordinator-persisted public bytes. */
export function generateBootstrapCapability({cellDir, manifest, manifestBytes}) {
  const bindings = validateHandoffBindings(manifest?.bindings);
  if (cellDir !== bindings.cellDir || !Buffer.isBuffer(manifestBytes) || manifestBytes.length > HANDOFF_LIMITS.metadataBytes || JSON.stringify(decodeJSON(manifestBytes)) !== JSON.stringify(manifest)) throw Error('bootstrap manifest mismatch');
  const capability = {version:1, kind:'public-bootstrap-capability', cellDir, handoffPath:path.join(cellDir,'public-handoff.txt'), manifestPath:path.join(cellDir,'public-handoff.json'), manifestBytes:manifestBytes.length, manifestSHA256:digest(manifestBytes), manifest};
  const bytes = encode(capability);
  if (bytes.length > HANDOFF_LIMITS.metadataBytes) throw Error('bootstrap capability byte limit');
  return {capability, bytes, sha256:digest(bytes)};
}
/** Bind one capability to its one fixed canonical cell and exact public manifest. */
function verifyCapability(capability, capabilityPath, manifestBytes) {
  exactKeys(capability, CAPABILITY_KEYS, 'bootstrap capability');
  const expected = generateBootstrapCapability({cellDir:capability.cellDir, manifest:capability.manifest, manifestBytes});
  if (capabilityPath !== path.join(capability.cellDir,'public-bootstrap.json') || JSON.stringify(capability) !== JSON.stringify(expected.capability)) throw Error('bootstrap capability mismatch');
  return expected.capability;
}
/** Build the complete output. The final marker hashes all preceding bytes; no self-hash is claimed. */
export function generateBootstrapOutput({payload, manifest, capabilitySHA256}) {
  if (!/^[a-f0-9]{64}$/.test(capabilitySHA256)) throw Error('invalid capability digest');
  parsePublicHandoff({payload, manifest, bindings:manifest?.bindings});
  const prefix = Buffer.from(`PUBLIC_BOOTSTRAP_BEGIN v1\ncapabilitySHA256=${capabilitySHA256}\npayloadBytes=${payload.length}\npayloadSHA256=${digest(payload)}\nOutput capacity is unknown. Stop if truncated or if the exact terminal marker is absent.\nPUBLIC_HANDOFF_BEGIN\n`);
  const body = Buffer.concat([prefix, payload, Buffer.from('PUBLIC_HANDOFF_END\n')]);
  const marker = bytes => Buffer.from(`PUBLIC_BOOTSTRAP_END v1 outputBytes=${bytes} bodyBytes=${body.length} bodySHA256=${digest(body)}\n`);
  let outputBytes = body.length;
  for (let i=0; i<8; i++) {
    const end = marker(outputBytes), total = body.length+end.length;
    if (total === outputBytes) return Buffer.concat([body, end]);
    outputBytes = total;
  }
  throw Error('bootstrap output framing did not converge');
}
/** Reject truncation, reordered bytes, extra suffixes, or any modified byte including final LF. */
export function verifyBootstrapOutput({output, payload, manifest, capabilitySHA256}) {
  const expected = generateBootstrapOutput({payload, manifest, capabilitySHA256});
  if (!Buffer.isBuffer(output) || !output.equals(expected)) throw Error('incomplete or changed bootstrap output');
  return {bytes:output.length, sha256:digest(output)};
}
/** The production emitter acknowledges only the local stdout write callback, not its consumer. */
async function emitStdout(output, {signal}) {
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = error => {
      if (settled) return; settled = true;
      signal.removeEventListener('abort', aborted);
      // A failed write callback can precede the stream's error event; keep its listener then.
      if (error) reject(error); else { process.stdout.off('error', failed); resolve(); }
    };
    const failed = error => { process.stdout.off('error', failed); finish(error); };
    const aborted = () => {
      const error = signal.reason instanceof Error ? signal.reason : Error('public bootstrap output aborted');
      finish(error);
      // Only this helper's own output stream is closed, never another process or process group.
      process.stdout.destroy(error);
    };
    process.stdout.once('error', failed);
    signal.addEventListener('abort', aborted, {once:true});
    if (signal.aborted) { aborted(); return; }
    process.stdout.write(output, finish);
  });
  return {bytes:output.length, sha256:digest(output)};
}
/** Perform the one supported invocation, with a durable reservation before any public output.
 * emit/clock are injectable for deterministic tests; CLI callers cannot override the fixed limit.
 * The local 60-second emission deadline starts at invocation; it never resets the supervisor clock.
 */
export async function runPublicBootstrap({capabilityPath, expectedCapabilitySHA256, emit=emitStdout, clock=CLOCK}) {
  const started = clock.now(); let lastObserved = started;
  if (!Number.isFinite(started) || started < 0) throw Error('invalid bootstrap clock');
  const now = () => { const value = clock.now(); if (!Number.isFinite(value) || value < lastObserved) throw Error('invalid bootstrap clock'); lastObserved = value; return value; };
  const deadline = started + LIMITS.actionMs;
  if (typeof capabilityPath !== 'string' || !path.isAbsolute(capabilityPath) || path.resolve(capabilityPath) !== capabilityPath || path.basename(capabilityPath) !== 'public-bootstrap.json' || !/^[a-f0-9]{64}$/.test(expectedCapabilitySHA256) || typeof emit !== 'function') throw Error('fixed capability path and expected digest required');
  const cellDir = path.dirname(capabilityPath);
  canonicalDirectory(cellDir);
  const capabilityBytes = readFixed(capabilityPath, HANDOFF_LIMITS.metadataBytes);
  if (digest(capabilityBytes) !== expectedCapabilitySHA256) throw Error('bootstrap capability digest mismatch');
  const capability = decodeJSON(capabilityBytes);
  exactKeys(capability, CAPABILITY_KEYS, 'bootstrap capability');
  if (capability.version !== 1 || capability.kind !== 'public-bootstrap-capability' || capability.cellDir !== cellDir || capability.manifestPath !== path.join(cellDir,'public-handoff.json') || capability.handoffPath !== path.join(cellDir,'public-handoff.txt')) throw Error('bootstrap capability path escape or invalid identity');
  if (!capabilityBytes.equals(encode(capability))) throw Error('noncanonical capability encoding');
  // Authentication above grants only this fixed capability. Everything after reservation is one-shot.
  const attempt = {version:1, kind:'public-bootstrap-attempt', status:'reserved', cellDir, capabilitySHA256:expectedCapabilitySHA256, capabilityBytes:capabilityBytes.length, scope:SCOPE};
  const attemptBytes = encode(attempt);
  exclusive(path.join(cellDir,'public-bootstrap-attempt.json'), attemptBytes);
  const identity = {dispatchIntentSHA256:null, capabilitySHA256:expectedCapabilitySHA256, capabilityBytes:capabilityBytes.length, manifestSHA256:capability.manifestSHA256, manifestBytes:capability.manifestBytes, manifest:capability.manifest};
  let expectedPayload = null, expectedOutput = null;
  const abort = new AbortController();
  const checkDeadline = () => { if (now() >= deadline) { const error = Error('public bootstrap local emission timeout'); abort.abort(error); throw error; } };
  try {
    checkDeadline();
    let receiptExists = false;
    try { fs.lstatSync(path.join(cellDir,'public-bootstrap-receipt.json')); receiptExists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (receiptExists) throw Error('bootstrap already has a receipt');
    const manifestBytes = readFixed(path.join(cellDir,'public-handoff.json'), HANDOFF_LIMITS.metadataBytes);
    checkDeadline();
    verifyCapability(capability, capabilityPath, manifestBytes);
    const manifest = decodeJSON(manifestBytes);
    if (JSON.stringify(manifest) !== JSON.stringify(capability.manifest)) throw Error('bootstrap frozen manifest changed');
    const payload = readFixed(path.join(cellDir,'public-handoff.txt'), HANDOFF_LIMITS.payloadBytes);
    checkDeadline();
    parsePublicHandoff({payload, manifest, bindings:manifest.bindings});
    const output = generateBootstrapOutput({payload, manifest, capabilitySHA256:expectedCapabilitySHA256});
    expectedOutput = {bytes:output.length, sha256:digest(output)}; expectedPayload = {...manifest.payload};
    const intentBytes = readFixed(path.join(cellDir,'actor-dispatch-intent.json'), HANDOFF_LIMITS.metadataBytes), intent = decodeJSON(intentBytes);
    if (intent.assignmentSHA256 !== manifest.bindings.assignmentSHA256 || intent.handoff?.handoffSHA256 !== manifest.payload.sha256 || intent.handoff?.capabilitySHA256 !== expectedCapabilitySHA256 || intent.handoff?.manifestSHA256 !== digest(manifestBytes) || JSON.stringify(intent.handoff?.bindings) !== JSON.stringify(manifest.bindings)) throw Error('bootstrap dispatch intent mismatch');
    identity.dispatchIntentSHA256 = digest(intentBytes);
    checkDeadline();
    const acknowledged = await new Promise((resolve, reject) => {
      let settled = false, timer;
      const finish = (error, value) => {
        if (settled) return; settled = true;
        clock.clearTimeout(timer);
        if (error) reject(error); else resolve(value);
      };
      const expire = () => {
        const error = Error('public bootstrap local emission timeout');
        finish(error); abort.abort(error);
      };
      try {
        const remaining = deadline-now();
        if (remaining <= 0) { expire(); return; }
        timer = clock.setTimeout(expire, remaining);
        Promise.resolve(emit(Buffer.from(output), {signal:abort.signal})).then(value => {
          if (settled) return;
          try { if (now() >= deadline) expire(); else finish(undefined, value); }
          catch (error) { finish(error); abort.abort(error); }
        }, error => finish(error));
      } catch (error) { finish(error); abort.abort(error); }
    });
    exactKeys(acknowledged, ['bytes','sha256'], 'bootstrap emission acknowledgement');
    if (acknowledged.bytes !== expectedOutput.bytes || acknowledged.sha256 !== expectedOutput.sha256) throw Error('incomplete bootstrap emission acknowledgement');
    if (now() >= deadline) { const error = Error('public bootstrap local emission timeout'); abort.abort(error); throw error; }
  } catch (error) {
    const receipt = {version:1, kind:'public-bootstrap-receipt', status:'failed', ...identity, attemptSHA256:digest(attemptBytes), expectedPayload, expectedOutput, emittedPayload:null, emittedOutput:null, reason:String(error), scope:SCOPE};
    try { exclusive(path.join(cellDir,'public-bootstrap-receipt.json'), encode(receipt)); }
    catch (receiptError) { throw new AggregateError([error, receiptError], `bootstrap failed: ${error.message}; receipt persistence failed; attempt retained; do not retry`); }
    throw new Error(`bootstrap validation or emission failed: ${error.message}; attempt retained; do not retry`, {cause:error});
  }
  const receipt = {version:1, kind:'public-bootstrap-receipt', status:'emitted', ...identity, attemptSHA256:digest(attemptBytes), expectedPayload, expectedOutput, emittedPayload:expectedPayload, emittedOutput:expectedOutput, scope:SCOPE};
  exclusive(path.join(cellDir,'public-bootstrap-receipt.json'), encode(receipt));
  return receipt;
}
/** Verify procedural receipt identity and complete-output counts; this does not authenticate it. */
export function verifyBootstrapReceipt({receipt, manifest, capability, capabilitySHA256, payload, dispatchIntentSHA256}) {
  exactKeys(receipt, ['version','kind','status','dispatchIntentSHA256','capabilitySHA256','capabilityBytes','manifestSHA256','manifestBytes','manifest','attemptSHA256','expectedPayload','expectedOutput','emittedPayload','emittedOutput','scope'], 'bootstrap receipt');
  if (!/^[a-f0-9]{64}$/.test(dispatchIntentSHA256) || receipt.dispatchIntentSHA256 !== dispatchIntentSHA256 || !/^[a-f0-9]{64}$/.test(capabilitySHA256) || receipt.version !== 1 || receipt.kind !== 'public-bootstrap-receipt' || receipt.status !== 'emitted' || receipt.scope !== SCOPE || receipt.capabilitySHA256 !== capabilitySHA256 || receipt.capabilityBytes !== encode(capability).length || receipt.manifestSHA256 !== capability.manifestSHA256 || receipt.manifestBytes !== capability.manifestBytes || JSON.stringify(receipt.manifest) !== JSON.stringify(manifest) || JSON.stringify(capability.manifest) !== JSON.stringify(manifest) || JSON.stringify(receipt.expectedPayload) !== JSON.stringify(manifest.payload) || JSON.stringify(receipt.emittedPayload) !== JSON.stringify(manifest.payload) || JSON.stringify(receipt.expectedOutput) !== JSON.stringify(receipt.emittedOutput) || !Number.isSafeInteger(receipt.emittedOutput?.bytes) || receipt.emittedOutput.bytes <= manifest.payload.bytes || !/^[a-f0-9]{64}$/.test(receipt.emittedOutput?.sha256) || !/^[a-f0-9]{64}$/.test(receipt.attemptSHA256)) throw Error('bootstrap receipt mismatch');
  if (digest(encode(capability)) !== capabilitySHA256) throw Error('bootstrap receipt capability encoding mismatch');
  const output = generateBootstrapOutput({payload, manifest, capabilitySHA256});
  if (receipt.expectedOutput.bytes !== output.length || receipt.expectedOutput.sha256 !== digest(output)) throw Error('bootstrap receipt output mismatch');
  const attempt = {version:1, kind:'public-bootstrap-attempt', status:'reserved', cellDir:manifest.bindings.cellDir, capabilitySHA256:receipt.capabilitySHA256, capabilityBytes:receipt.capabilityBytes, scope:SCOPE};
  if (digest(encode(attempt)) !== receipt.attemptSHA256) throw Error('bootstrap receipt attempt mismatch');
  return receipt;
}

export const formatBootstrapOutput = generateBootstrapOutput;

// Leaf-only imports above: importing this module must never execute the supervisor CLI.
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  if (process.argv.length !== 4) { process.stderr.write('Usage: bootstrap.mjs /absolute/cell/public-bootstrap.json expectedSHA256\n'); process.exitCode = 1; }
  else runPublicBootstrap({capabilityPath:process.argv[2], expectedCapabilitySHA256:process.argv[3]}).catch(error => { process.stderr.write(`public bootstrap failed: ${error.message}\n`); process.exitCode = 1; });
}
