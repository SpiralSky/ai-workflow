import {createHash, randomBytes} from 'node:crypto';

const VERSION = 1;
const MAX_ENTRIES = 256, MAX_SOURCES = 256, MAX_BYTES = 16 * 1024 * 1024, MAX_HITS = 4096;
const HASH = /^[a-f0-9]{64}$/, ID = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,159}$/;
const MARKER = /^AIW_CANARY_[a-f0-9]{32}$/;
const PHASES = ['solve', 'grade', 'audit'], ROLES = ['coordinator', 'solver', 'candidate'];
const KINDS = ['completion-request', 'completion-response', 'completion-control', 'native-event', 'solver-output', 'submission', 'submission-record', 'relay', 'host-journal', 'native-tool-log', 'grading-output', 'audit-output', 'run-output'];
const REQUIRED_KINDS = ['solver-output', 'relay', 'host-journal'];
const hash = bytes => createHash('sha256').update(bytes).digest('hex');

/** Canonical JSON is a content commitment, not authentication against same-user rewrites. */
function canonical(value) {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}';
  return JSON.stringify(value);
}
function keys(value, expected) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).sort().join(',') !== [...expected].sort().join(',')) throw Error('invalid audit object');
}
function id(value) { if (typeof value !== 'string' || !ID.test(value) || /AIW_CANARY_[a-f0-9]{32}/.test(value)) throw Error('invalid audit identifier'); }
function digest(value) { if (typeof value !== 'string' || !HASH.test(value)) throw Error('invalid audit digest'); }
function list(values, max, nonempty = true) {
  if (!Array.isArray(values) || values.length > max || (nonempty && !values.length)) throw Error('invalid audit list');
}
function scope(value) {
  keys(value, ['role', 'phase', 'cellId']);
  if (!ROLES.includes(value.role) || !PHASES.includes(value.phase)) throw Error('invalid audit scope');
  if (value.cellId !== null) id(value.cellId);
  if (value.role !== 'coordinator' && value.cellId === null) throw Error('actor scope requires a cell');
}
function descriptor(entry, secret) {
  keys(entry, ['artifactId', 'role', 'cellId', 'authorizedScopes', secret ? 'marker' : 'canarySHA256']);
  id(entry.artifactId);
  if (!['grader', 'run-output'].includes(entry.role)) throw Error('invalid canary artifact role');
  if (entry.role === 'grader' ? entry.cellId !== null : typeof entry.cellId !== 'string') throw Error('invalid canary artifact cell');
  if (entry.cellId !== null) id(entry.cellId);
  if (secret) { if (typeof entry.marker !== 'string' || !MARKER.test(entry.marker)) throw Error('invalid private canary'); }
  else digest(entry.canarySHA256);
  list(entry.authorizedScopes, 16);
  const seen = new Set();
  for (const allowed of entry.authorizedScopes) {
    scope(allowed);
    if (allowed.role === 'candidate' || (allowed.role === 'solver' && (entry.role !== 'run-output' || allowed.cellId !== entry.cellId || allowed.phase !== 'solve'))) throw Error('unsafe canary authorization');
    const key = canonical(allowed); if (seen.has(key)) throw Error('duplicate canary scope'); seen.add(key);
  }
}
function validateRegistry(registry, secret) {
  keys(registry, secret ? ['version', 'campaignId', 'entries'] : ['version', 'campaignId', 'privateRegistrySHA256', 'entries']);
  if (registry.version !== VERSION) throw Error('invalid canary registry version');
  id(registry.campaignId); if (!secret) digest(registry.privateRegistrySHA256);
  list(registry.entries, MAX_ENTRIES);
  const ids = new Set(), markers = new Set();
  for (const entry of registry.entries) {
    descriptor(entry, secret);
    const marker = secret ? entry.marker : entry.canarySHA256;
    if (ids.has(entry.artifactId) || markers.has(marker)) throw Error('duplicate canary');
    ids.add(entry.artifactId); markers.add(marker);
  }
}

/** Create private marker data only. This performs no I/O, execution, publication or insertion.
 * Store the returned object outside solve-time files; shared plugin access remains possible.
 * Each artifact supplies artifactId, role, cellId and explicit authorizedScopes.
 */
export function createPrivateCanaryRegistry({campaignId, artifacts}) {
  id(campaignId); list(artifacts, MAX_ENTRIES);
  const entries = artifacts.map(artifact => {
    keys(artifact, ['artifactId', 'role', 'cellId', 'authorizedScopes']);
    return {...structuredClone(artifact), marker: 'AIW_CANARY_' + randomBytes(16).toString('hex')};
  });
  const registry = {version: VERSION, campaignId, entries}; validateRegistry(registry, true); return registry;
}

/** Project secrets to public hash commitments. No literal marker is returned. */
export function publicCanaryRegistry(privateRegistry) {
  validateRegistry(privateRegistry, true);
  return {version: VERSION, campaignId: privateRegistry.campaignId, privateRegistrySHA256: hash(Buffer.from(canonical(privateRegistry))),
    entries: privateRegistry.entries.map(({marker, ...entry}) => ({...structuredClone(entry), canarySHA256: hash(Buffer.from(marker))}))};
}

/** Exact public registry bytes to retain and hash in screeningControls.canaryRegistrySHA256. */
export function canaryRegistryBytes(registry) {
  validateRegistry(registry, false); return Buffer.from(canonical(registry) + '\n');
}

/** Private retained output envelope. Keep this away from actor-visible protocol frames.
 * Raw bytes are copied as base64 without parsing, evaluating, normalizing or altering them.
 */
export function createOutputCanaryEnvelope({privateRegistry, artifactId, raw}) {
  validateRegistry(privateRegistry, true); id(artifactId);
  if (!Buffer.isBuffer(raw) || raw.length > MAX_BYTES) throw Error('invalid output bytes');
  const entry = privateRegistry.entries.find(item => item.artifactId === artifactId);
  if (!entry || entry.role !== 'run-output') throw Error('unknown run output artifact');
  return {version: VERSION, artifactId, cellId: entry.cellId, canary: entry.marker, rawSHA256: hash(raw), rawBytes: raw.length, rawBase64: raw.toString('base64')};
}

/** Audit coordinator-supplied observations as data, without I/O or executing their contents.
 * Every source: id, kind, scope:{role,phase,cellId}, bytes:Buffer|null,
 * expectedSHA256:string|null, complete:boolean. Missing/truncated required evidence fails eligibility.
 * Submission inventory entries require sources named submission/<relative-path>, bound to their
 * actual hashes/byte lengths. The committed submission-result JSON is scanned automatically.
 * Solver-output, relay and host-journal observations are mandatory and every provided one is required.
 * The coordinator must derive their exhaustive source list independently of the claimed audit report.
 * Source scope/completeness and access findings are coordinator assertions, not authenticated logs.
 * Access findings use sourceId, byteOffset and outcome ('attempted','denied','read-observed','unknown');
 * supply only observed unauthorized access, never infer a read from source text or a denied attempt.
 * Literal ASCII markers only: encoded/removed markers, silent reads and unavailable logs are unseen.
 */
export function auditScreeningEvidence({registry, expectedRegistrySHA256, campaignSHA256, submissionResultBytes,
  expectedSubmissionSHA256, cellId, sources, requiredSourceIds, accessFindings = []}) {
  digest(expectedRegistrySHA256); digest(campaignSHA256); digest(expectedSubmissionSHA256); id(cellId);
  if (hash(canaryRegistryBytes(registry)) !== expectedRegistrySHA256) throw Error('canary registry commitment mismatch');
  if (!Buffer.isBuffer(submissionResultBytes) || submissionResultBytes.length > MAX_BYTES || hash(submissionResultBytes) !== expectedSubmissionSHA256) throw Error('submission commitment mismatch');
  let submission; try { submission = JSON.parse(new TextDecoder('utf-8', {fatal: true}).decode(submissionResultBytes)); } catch { throw Error('invalid submission record'); }
  if (!submission?.inventory || typeof submission.inventory !== 'object' || Array.isArray(submission.inventory)) throw Error('missing submission inventory');
  const files = Object.entries(submission.inventory); list(files, 200);
  for (const [relative, entry] of files) {
    if (!/^[A-Za-z0-9_.-]+(?:\/[A-Za-z0-9_.-]+)*$/.test(relative) || relative.split('/').some(part => part === '.' || part === '..')) throw Error('invalid submission inventory path');
    id('submission/' + relative);
    if (!entry || typeof entry !== 'object' || !Number.isSafeInteger(entry.bytes) || entry.bytes < 0 || entry.bytes > MAX_BYTES) throw Error('invalid submission inventory entry');
    digest(entry.sha256);
  }
  if (!registry.entries.some(entry => entry.role === 'grader')) throw Error('missing grader canary');
  if (!registry.entries.some(entry => entry.role === 'run-output' && entry.cellId === cellId)) throw Error('missing cell output canary');
  list(sources, MAX_SOURCES, false); list(requiredSourceIds, MAX_SOURCES); list(accessFindings, MAX_HITS, false);
  const required = new Set(); for (const value of requiredSourceIds) { id(value); if (required.has(value)) throw Error('duplicate required source'); required.add(value); }
  const inventorySources = new Map(files.map(([relative, entry]) => ['submission/' + relative, entry]));
  for (const sourceId of inventorySources.keys()) required.add(sourceId);
  for (const source of sources) {
    if (source?.id === 'submission-result' || source?.kind === 'submission-record') throw Error('reserved submission record source');
    if (REQUIRED_KINDS.includes(source?.kind)) required.add(source.id);
  }
  const missingRequiredKinds = REQUIRED_KINDS.filter(kind => !sources.some(source => source?.kind === kind));
  const allSources = [...sources, {id: 'submission-result', kind: 'submission-record', scope: {role: 'solver', phase: 'solve', cellId}, bytes: submissionResultBytes, expectedSHA256: expectedSubmissionSHA256, complete: true}];
  const known = new Map(registry.entries.map(entry => [entry.canarySHA256, entry]));
  const observed = new Map(), manifests = [], hits = []; let bytesScanned = 0;
  for (const source of allSources) {
    keys(source, ['id', 'kind', 'scope', 'bytes', 'expectedSHA256', 'complete']); id(source.id); scope(source.scope);
    if (!KINDS.includes(source.kind) || typeof source.complete !== 'boolean' || observed.has(source.id)) throw Error('invalid audit source');
    if (source.scope.role !== 'coordinator' && source.scope.cellId !== cellId) throw Error('source actor cell mismatch');
    if (['submission', 'submission-record', ...REQUIRED_KINDS].includes(source.kind) && (source.scope.role !== 'solver' || source.scope.phase !== 'solve')) throw Error('solver source scope mismatch');
    const file = inventorySources.get(source.id);
    if (file ? source.kind !== 'submission' : source.kind === 'submission') throw Error('submission source inventory mismatch');
    if (source.bytes === null) {
      if (source.complete || source.expectedSHA256 !== null) throw Error('invalid missing evidence');
      observed.set(source.id, {source, bytes: null});
      manifests.push({id: source.id, kind: source.kind, scope: source.scope, sha256: null, bytes: null, status: 'missing'}); continue;
    }
    if (!Buffer.isBuffer(source.bytes)) throw Error('audit source requires bytes');
    if (file && source.complete && (source.bytes.length !== file.bytes || source.expectedSHA256 !== file.sha256)) throw Error('submission source inventory mismatch');
    bytesScanned += source.bytes.length; if (bytesScanned > MAX_BYTES) throw Error('audit byte limit');
    digest(source.expectedSHA256); const bytes = Buffer.from(source.bytes), sha256 = hash(bytes);
    if (sha256 !== source.expectedSHA256) throw Error('audit source commitment mismatch');
    observed.set(source.id, {source, bytes});
    manifests.push({id: source.id, kind: source.kind, scope: structuredClone(source.scope), sha256, bytes: bytes.length, status: source.complete ? 'complete' : 'truncated'});
    // latin1 preserves byte offsets and finds markers even in otherwise invalid UTF-8 evidence.
    for (const match of bytes.toString('latin1').matchAll(/AIW_CANARY_[a-f0-9]{32}/g)) {
      if (hits.length >= MAX_HITS) throw Error('audit hit limit');
      const canarySHA256 = hash(Buffer.from(match[0])), entry = known.get(canarySHA256);
      const authorized = entry?.authorizedScopes.some(allowed => allowed.role === source.scope.role && allowed.phase === source.scope.phase && (allowed.cellId === null || allowed.cellId === source.scope.cellId));
      hits.push({canarySHA256, artifactId: entry?.artifactId ?? null, sourceId: source.id, byteOffset: match.index, scope: structuredClone(source.scope), classification: entry ? authorized ? 'authorized' : 'unauthorized' : 'unresolved'});
    }
  }
  for (const sourceId of required) if (!observed.has(sourceId)) manifests.push({id: sourceId, kind: null, scope: null, sha256: null, bytes: null, status: 'missing'});
  const findings = accessFindings.map(finding => {
    keys(finding, ['sourceId', 'byteOffset', 'outcome']); id(finding.sourceId);
    const source = observed.get(finding.sourceId);
    if (!source?.bytes || !Number.isSafeInteger(finding.byteOffset) || finding.byteOffset < 0 || finding.byteOffset >= source.bytes.length || !['attempted', 'denied', 'read-observed', 'unknown'].includes(finding.outcome)) throw Error('invalid observed access finding');
    return {...finding};
  });
  const incompleteRequired = [...required].some(sourceId => !observed.get(sourceId)?.source.complete);
  const contaminated = hits.some(hit => hit.classification === 'unauthorized') || findings.some(finding => finding.outcome === 'read-observed');
  const unresolved = hits.some(hit => hit.classification === 'unresolved');
  const assessment = contaminated ? 'contamination-detected' : findings.length ? 'protocol-violation-observed' : incompleteRequired || missingRequiredKinds.length || unresolved ? 'inconclusive' : 'no-contamination-detected/partial-audit';
  const status = kind => {
    const entries = manifests.filter(source => source.kind === kind);
    return !entries.length || entries.every(source => source.status === 'missing') ? 'unavailable' : entries.every(source => source.status === 'complete') ? 'provided-records-complete' : 'partial';
  };
  return {version: VERSION, campaignSHA256, submissionSHA256: expectedSubmissionSHA256, cellId, canaryRegistrySHA256: expectedRegistrySHA256,
    requiredSourceIds: [...required].sort(), missingRequiredKinds, sources: manifests.sort((a, b) => a.id.localeCompare(b.id)), bytesScanned,
    coverage: {scope: 'coordinator-supplied observations only', relay: status('relay'), hostJournal: status('host-journal'), nativeToolCalls: status('native-tool-log') === 'unavailable' ? 'unavailable' : 'partial', subprocessReads: 'unobserved', absenceProof: false},
    hits: hits.sort((a, b) => a.sourceId.localeCompare(b.sourceId) || a.byteOffset - b.byteOffset), accessFindings: findings,
    assessment, comparisonEligible: assessment === 'no-contamination-detected/partial-audit',
    limitations: ['Shared-user and shared-plugin access remain possible.', 'Canary absence does not prove absence of reads or contamination.', 'Scope, completeness and access findings rely on the coordinator; hashes are not authentication.', 'Native tool log coverage is incomplete; subprocess reads are unobserved.', 'Only literal markers in supplied bytes are detected; no encoded-marker or syscall analysis.']};
}

/** Recompute from committed registry and retained source bytes; never trust report booleans alone. */
export function verifyScreeningAudit({report, ...inputs}) {
  const expected = auditScreeningEvidence(inputs);
  if (canonical(report) !== canonical(expected)) throw Error('screening audit report mismatch');
  return expected;
}
