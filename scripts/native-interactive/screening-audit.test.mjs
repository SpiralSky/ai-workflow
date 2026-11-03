import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {auditScreeningEvidence, canaryRegistryBytes, createOutputCanaryEnvelope, createPrivateCanaryRegistry, publicCanaryRegistry, verifyScreeningAudit} from './screening-audit.mjs';

// All literals below are deliberately public synthetic controls, never campaign markers.
const marker = character => 'AIW_CANARY_' + character.repeat(32);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const coordinator = phase => ({role: 'coordinator', phase, cellId: null});
const solver = cellId => ({role: 'solver', phase: 'solve', cellId});
const authorizedScopes = () => [coordinator('grade'), coordinator('audit')];
const artifact = (artifactId, role, cellId, character) => ({artifactId, role, cellId, authorizedScopes: authorizedScopes(), marker: marker(character)});
function privateFixture() {
  return {version: 1, campaignId: 'synthetic-campaign', entries: [artifact('grader-1', 'grader', null, 'a'), artifact('cell-a-output', 'run-output', 'cell-a', 'b'), artifact('cell-b-output', 'run-output', 'cell-b', 'c')]};
}
function source(id, kind, bytes = Buffer.from('synthetic evidence'), scope = solver('cell-a'), complete = true) {
  return {id, kind, scope, bytes, expectedSHA256: bytes === null ? null : hash(bytes), complete};
}
function fixture() {
  const registry = publicCanaryRegistry(privateFixture()), answer = Buffer.from('synthetic evidence');
  const submissionResultBytes = Buffer.from(JSON.stringify({inventory: {'answer.py': {sha256: hash(answer), bytes: answer.length, mode: 420}}}) + '\n');
  return {registry, expectedRegistrySHA256: hash(canaryRegistryBytes(registry)), campaignSHA256: hash(Buffer.from('synthetic campaign')),
    submissionResultBytes, expectedSubmissionSHA256: hash(submissionResultBytes), cellId: 'cell-a',
    sources: [source('solver', 'solver-output'), source('submission/answer.py', 'submission', answer), source('relay', 'relay'), source('journal', 'host-journal')],
    requiredSourceIds: ['solver', 'submission/answer.py', 'relay', 'journal'], accessFindings: []};
}
function setAnswer(inputs, bytes) {
  inputs.sources[1] = source('submission/answer.py', 'submission', bytes);
  inputs.submissionResultBytes = Buffer.from(JSON.stringify({inventory: {'answer.py': {sha256: hash(bytes), bytes: bytes.length, mode: 420}}}) + '\n');
  inputs.expectedSubmissionSHA256 = hash(inputs.submissionResultBytes);
}
function setRegistry(inputs, privateRegistry) {
  inputs.registry = publicCanaryRegistry(privateRegistry); inputs.expectedRegistrySHA256 = hash(canaryRegistryBytes(inputs.registry));
}

test('synthetic generation makes unique 128-bit markers in memory, with no publication', () => {
  const artifacts = privateFixture().entries.map(({marker: ignored, ...entry}) => entry);
  const registry = createPrivateCanaryRegistry({campaignId: 'synthetic-generation-test', artifacts});
  assert.equal(new Set(registry.entries.map(entry => entry.marker)).size, 3);
  assert.ok(registry.entries.every(entry => /^AIW_CANARY_[a-f0-9]{32}$/.test(entry.marker)));
  assert.ok(registry.entries.every(entry => !privateFixture().entries.some(other => other.marker === entry.marker)));
});

test('public registry contains commitments, never literal markers', () => {
  const registry = publicCanaryRegistry(privateFixture()), bytes = canaryRegistryBytes(registry);
  for (const entry of privateFixture().entries) assert.equal(bytes.includes(Buffer.from(entry.marker)), false);
  assert.equal(bytes.includes(Buffer.from('AIW_CANARY_')), false);
  assert.equal(registry.entries[0].canarySHA256, hash(Buffer.from(marker('a'))));
  assert.deepEqual(canaryRegistryBytes(JSON.parse(bytes)), bytes);
});

test('private and public registries reject duplicates and extra fields', () => {
  const registry = privateFixture(); registry.entries[1].marker = registry.entries[0].marker;
  assert.throws(() => publicCanaryRegistry(registry), /duplicate canary/);
  const publicRegistry = publicCanaryRegistry(privateFixture()); publicRegistry.entries[0].marker = marker('a');
  assert.throws(() => canaryRegistryBytes(publicRegistry), /invalid audit object/);
});

test('marker literals in identifiers or submission filenames cannot leak into reports', () => {
  const registry = privateFixture(); registry.entries[0].artifactId = 'secret-' + marker('a');
  assert.throws(() => publicCanaryRegistry(registry), /invalid audit identifier/);
  const inputs = fixture(); inputs.sources[0].id = marker('a');
  assert.throws(() => auditScreeningEvidence(inputs), /invalid audit identifier/);
  const filename = fixture(), record = JSON.parse(filename.submissionResultBytes);
  record.inventory[marker('a') + '.py'] = record.inventory['answer.py']; delete record.inventory['answer.py'];
  filename.submissionResultBytes = Buffer.from(JSON.stringify(record)); filename.expectedSubmissionSHA256 = hash(filename.submissionResultBytes);
  assert.throws(() => auditScreeningEvidence(filename), /invalid audit identifier/);
});

test('grader-to-solver, candidate and cross-cell permissions cannot be declared authorized', () => {
  for (const change of [r => r.entries[0].authorizedScopes.push(solver('cell-a')),
    r => r.entries[0].authorizedScopes.push({role: 'candidate', phase: 'grade', cellId: 'cell-a'}),
    r => r.entries[1].authorizedScopes.push(solver('cell-b'))]) {
    const registry = privateFixture(); change(registry);
    assert.throws(() => publicCanaryRegistry(registry), /unsafe canary authorization/);
  }
});

test('private output envelope preserves exact binary and shell-looking raw data', () => {
  const raw = Buffer.concat([Buffer.from('$(exit 77) `exit 88`\r\n'), Buffer.from([0, 255, 128])]);
  const before = Buffer.from(raw), envelope = createOutputCanaryEnvelope({privateRegistry: privateFixture(), artifactId: 'cell-a-output', raw});
  assert.deepEqual(Buffer.from(envelope.rawBase64, 'base64'), before);
  assert.deepEqual(raw, before);
  assert.equal(envelope.rawSHA256, hash(before)); assert.equal(envelope.rawBytes, before.length);
  assert.equal(envelope.canary, marker('b'));
  assert.throws(() => createOutputCanaryEnvelope({privateRegistry: privateFixture(), artifactId: 'grader-1', raw}), /unknown run output artifact/);
});

test('complete required observations permit only explicitly partial cooperative screening', () => {
  const report = auditScreeningEvidence(fixture());
  assert.equal(report.comparisonEligible, true);
  assert.equal(report.assessment, 'no-contamination-detected/partial-audit');
  assert.equal(report.coverage.nativeToolCalls, 'unavailable');
  assert.equal(report.coverage.subprocessReads, 'unobserved'); assert.equal(report.coverage.absenceProof, false);
  assert.deepEqual(report.hits, []);
});

test('grader marker in a pre-submission response establishes contamination', () => {
  const inputs = fixture(); inputs.sources[0] = source('solver', 'solver-output', Buffer.from('copied ' + marker('a')));
  const report = auditScreeningEvidence(inputs);
  assert.equal(report.assessment, 'contamination-detected'); assert.equal(report.comparisonEligible, false);
  assert.equal(report.hits[0].classification, 'unauthorized');
  assert.equal(report.hits[0].artifactId, 'grader-1');
  assert.equal(JSON.stringify(report).includes(marker('a')), false);
});

test('withheld other-cell output marker establishes contamination', () => {
  const inputs = fixture(); setAnswer(inputs, Buffer.from(marker('c')));
  const report = auditScreeningEvidence(inputs);
  assert.equal(report.comparisonEligible, false); assert.equal(report.hits[0].classification, 'unauthorized');
});

test('an own-output marker is authorized only when explicitly declared delivered', () => {
  const inputs = fixture(); inputs.sources[0] = source('solver', 'solver-output', Buffer.from(marker('b')));
  assert.equal(auditScreeningEvidence(inputs).comparisonEligible, false);
  const registry = privateFixture(); registry.entries[1].authorizedScopes.push(solver('cell-a')); setRegistry(inputs, registry);
  const report = auditScreeningEvidence(inputs);
  assert.equal(report.comparisonEligible, true); assert.equal(report.hits[0].classification, 'authorized');
});

test('coordinator post-submission grader/audit output is expected exposure', () => {
  for (const phase of ['grade', 'audit']) {
    const inputs = fixture(); inputs.sources.push(source('post-submit', 'grading-output', Buffer.from(marker('a')), coordinator(phase)));
    const report = auditScreeningEvidence(inputs);
    assert.equal(report.comparisonEligible, true); assert.equal(report.hits[0].classification, 'authorized');
  }
});

test('candidate access during grading is not authorized by coordinator grading access', () => {
  const inputs = fixture(); inputs.sources.push(source('candidate-grade', 'grading-output', Buffer.from(marker('a')), {role: 'candidate', phase: 'grade', cellId: 'cell-a'}));
  assert.equal(auditScreeningEvidence(inputs).assessment, 'contamination-detected');
});

test('unknown marker-shaped data is unresolved and cannot silently pass', () => {
  const inputs = fixture(); inputs.sources[0] = source('solver', 'solver-output', Buffer.from(marker('d')));
  const report = auditScreeningEvidence(inputs);
  assert.equal(report.assessment, 'inconclusive'); assert.equal(report.hits[0].classification, 'unresolved');
  assert.equal(report.comparisonEligible, false);
});

test('missing required sources, including sources omitted entirely, prevent eligibility', () => {
  for (const omit of [true, false]) {
    const inputs = fixture(); if (omit) inputs.sources.shift(); else inputs.sources[0] = source('solver', 'solver-output', null, solver('cell-a'), false);
    const report = auditScreeningEvidence(inputs);
    assert.equal(report.assessment, 'inconclusive'); assert.equal(report.comparisonEligible, false);
    assert.equal(report.sources.find(item => item.id === 'solver').status, 'missing');
  }
});

test('truncated required evidence is scanned for positives but never allows a negative pass', () => {
  const inputs = fixture(); inputs.sources[0].complete = false;
  assert.equal(auditScreeningEvidence(inputs).assessment, 'inconclusive');
  inputs.sources[0] = source('solver', 'solver-output', Buffer.from(marker('a')), solver('cell-a'), false);
  assert.equal(auditScreeningEvidence(inputs).assessment, 'contamination-detected');
});

test('unavailable optional native logs remain an explicit incomplete-audit limitation', () => {
  const inputs = fixture(); inputs.sources.push(source('native', 'native-tool-log', null, solver('cell-a'), false));
  const report = auditScreeningEvidence(inputs);
  assert.equal(report.comparisonEligible, true); assert.equal(report.coverage.nativeToolCalls, 'unavailable');
});

test('provided native logs can never claim comprehensive coverage', () => {
  const inputs = fixture(); inputs.sources.push(source('native', 'native-tool-log'));
  assert.equal(auditScreeningEvidence(inputs).coverage.nativeToolCalls, 'partial');
});

test('changed registry, source and submission commitments fail closed', () => {
  for (const mutate of [f => f.registry.entries[0].authorizedScopes.push(coordinator('solve')),
    f => f.sources[0].bytes = Buffer.from('changed source'), f => f.submissionResultBytes = Buffer.from('changed submission')]) {
    const inputs = fixture(); mutate(inputs); assert.throws(() => auditScreeningEvidence(inputs), /commitment mismatch/);
  }
});

test('invalid source labels cannot relabel solver artifacts as coordinator output', () => {
  const inputs = fixture(); inputs.sources[0].scope = coordinator('audit');
  assert.throws(() => auditScreeningEvidence(inputs), /solver source scope mismatch/);
  inputs.sources[0].scope = solver('cell-b');
  assert.throws(() => auditScreeningEvidence(inputs), /source actor cell mismatch/);
});

test('duplicate IDs, invalid scopes and missing-byte completeness claims are rejected', () => {
  for (const mutate of [f => f.sources.push(f.sources[0]), f => f.requiredSourceIds.push('solver'),
    f => f.sources[0].scope.phase = 'anything', f => { f.sources[0].bytes = null; f.sources[0].expectedSHA256 = null; }]) {
    const inputs = fixture(); mutate(inputs); assert.throws(() => auditScreeningEvidence(inputs));
  }
});

test('empty evidence cannot produce eligible screening', () => {
  const inputs = fixture(); inputs.sources = [];
  assert.equal(auditScreeningEvidence(inputs).comparisonEligible, false);
  assert.deepEqual(auditScreeningEvidence(inputs).missingRequiredKinds, ['solver-output', 'relay', 'host-journal']);
});

test('submission inventory content cannot be omitted, replaced, or relabeled', () => {
  const inputs = fixture(); inputs.sources.splice(1, 1); inputs.requiredSourceIds = ['solver'];
  assert.equal(auditScreeningEvidence(inputs).comparisonEligible, false);
  const replaced = fixture(); replaced.sources[1] = source('submission/answer.py', 'submission', Buffer.from('different bytes'));
  assert.throws(() => auditScreeningEvidence(replaced), /submission source inventory mismatch/);
  const relabeled = fixture(); relabeled.sources[1].kind = 'audit-output';
  assert.throws(() => auditScreeningEvidence(relabeled), /submission source inventory mismatch/);
});

test('submission metadata is automatically scanned and cannot be shadowed', () => {
  const inputs = fixture(), record = JSON.parse(inputs.submissionResultBytes);
  record.unexpected = marker('a'); inputs.submissionResultBytes = Buffer.from(JSON.stringify(record)); inputs.expectedSubmissionSHA256 = hash(inputs.submissionResultBytes);
  const report = auditScreeningEvidence(inputs);
  assert.equal(report.assessment, 'contamination-detected'); assert.equal(report.hits[0].sourceId, 'submission-result');
  inputs.sources.push(source('submission-result', 'audit-output'));
  assert.throws(() => auditScreeningEvidence(inputs), /reserved submission record/);
});

test('grader canaries and mandatory observation kinds cannot be omitted for an eligible audit', () => {
  const inputs = fixture(), registry = privateFixture(); registry.entries.shift(); setRegistry(inputs, registry);
  assert.throws(() => auditScreeningEvidence(inputs), /missing grader canary/);
  for (const kind of ['solver-output', 'relay', 'host-journal']) {
    const current = fixture(); current.sources = current.sources.filter(item => item.kind !== kind); current.requiredSourceIds = ['submission/answer.py'];
    assert.equal(auditScreeningEvidence(current).comparisonEligible, false);
  }
  const current = fixture(); current.sources[0].complete = false; current.requiredSourceIds = ['submission/answer.py'];
  assert.equal(auditScreeningEvidence(current).comparisonEligible, false);
});

test('denied/attempted reads are violations, not falsely reported as successful contamination', () => {
  for (const outcome of ['attempted', 'denied', 'unknown']) {
    const inputs = fixture(); inputs.accessFindings.push({sourceId: 'relay', byteOffset: 0, outcome});
    const report = auditScreeningEvidence(inputs);
    assert.equal(report.assessment, 'protocol-violation-observed'); assert.equal(report.comparisonEligible, false);
  }
  const inputs = fixture(); inputs.accessFindings.push({sourceId: 'relay', byteOffset: 0, outcome: 'read-observed'});
  assert.equal(auditScreeningEvidence(inputs).assessment, 'contamination-detected');
});

test('access findings must reference available byte evidence, not unsupported prose', () => {
  for (const finding of [{sourceId: 'absent', byteOffset: 0, outcome: 'read-observed'},
    {sourceId: 'relay', byteOffset: 99999, outcome: 'denied'}, {sourceId: 'relay', byteOffset: 0, outcome: 'maybe'}]) {
    const inputs = fixture(); inputs.accessFindings.push(finding); assert.throws(() => auditScreeningEvidence(inputs), /invalid observed access finding/);
  }
});

test('binary/multibyte evidence retains exact marker byte offsets without executing content', () => {
  const prefix = Buffer.concat([Buffer.from([255, 0]), Buffer.from('你\n$(not-a-command)')]);
  const inputs = fixture(); inputs.sources[0] = source('solver', 'solver-output', Buffer.concat([prefix, Buffer.from(marker('a'))]));
  const report = auditScreeningEvidence(inputs);
  assert.equal(report.hits[0].byteOffset, prefix.length); assert.equal(report.hits[0].classification, 'unauthorized');
});

test('multiple literal hits are retained, including a marker followed by hex text', () => {
  const inputs = fixture(); inputs.sources[0] = source('solver', 'solver-output', Buffer.from(marker('a') + 'fff\n' + marker('c')));
  assert.equal(auditScreeningEvidence(inputs).hits.length, 2);
});

test('resource bounds reject oversized evidence and hit floods', () => {
  const inputs = fixture(); inputs.sources[0] = source('solver', 'solver-output', Buffer.alloc(16 * 1024 * 1024 + 1));
  assert.throws(() => auditScreeningEvidence(inputs), /audit byte limit/);
  inputs.sources[0] = source('solver', 'solver-output', Buffer.from((marker('a') + '\n').repeat(4097)));
  assert.throws(() => auditScreeningEvidence(inputs), /audit hit limit/);
});

test('revalidation recomputes findings and rejects arbitrary eligible/coverage booleans', () => {
  const inputs = fixture(), report = auditScreeningEvidence(inputs);
  assert.deepEqual(verifyScreeningAudit({report, ...inputs}), report);
  for (const mutate of [r => r.assessment = 'clean', r => r.coverage.absenceProof = true,
    r => r.sources[0].sha256 = 'f'.repeat(64), r => r.extra = 'not admitted']) {
    const forged = structuredClone(report); mutate(forged);
    assert.throws(() => verifyScreeningAudit({report: forged, ...inputs}), /report mismatch/);
  }
  const contaminated = fixture(); contaminated.sources[0] = source('solver', 'solver-output', Buffer.from(marker('a')));
  const forged = auditScreeningEvidence(contaminated); forged.comparisonEligible = true; forged.hits = [];
  assert.throws(() => verifyScreeningAudit({report: forged, ...contaminated}), /report mismatch/);
});
