import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {publicCanaryRegistry,canaryRegistryBytes,auditScreeningEvidence,verifyScreeningAudit} from './screening-audit.mjs';
const hash=x=>createHash('sha256').update(x).digest('hex');
const marker=c=>'AIW_CANARY_'+c.repeat(32);
const scopes=[{role:'coordinator',phase:'grade',cellId:null},{role:'coordinator',phase:'audit',cellId:null}];
const art=(artifactId,role,cellId,c)=>({artifactId,role,cellId,marker:marker(c),authorizedScopes:structuredClone(scopes)});
const priv=(campaignId,entries)=>({version:1,campaignId,entries});
function composite(){return {version:2,campaignId:'new',historicalRegistry:publicCanaryRegistry(priv('old',[art('grader','grader',null,'a'),art('old-output','run-output','old-cell','b')])),newOutputRegistry:publicCanaryRegistry(priv('new',[art('new-output','run-output','new-cell','c')]))};}
function input(registry=composite(),text='ordinary evidence'){
 const raw=Buffer.from(text),s={inventory:{'answer.py':{sha256:hash(raw),bytes:raw.length,mode:420}}},submissionResultBytes=Buffer.from(JSON.stringify(s));
 const source=(id,kind)=>({id,kind,scope:{role:'solver',phase:'solve',cellId:'new-cell'},bytes:raw,expectedSHA256:hash(raw),complete:true});
 return {registry,expectedRegistrySHA256:hash(canaryRegistryBytes(registry)),campaignSHA256:hash('campaign'),submissionResultBytes,expectedSubmissionSHA256:hash(submissionResultBytes),cellId:'new-cell',sources:[source('solver','solver-output'),source('relay','relay'),source('journal','host-journal'),source('submission/answer.py','submission')],requiredSourceIds:['solver','relay','journal','submission/answer.py']};
}
test('honest composite retains both private commitments and complete historical bytes',()=>{const c=composite(),before=canaryRegistryBytes(c.historicalRegistry);assert.equal(Object.hasOwn(c,'privateRegistrySHA256'),false);assert.deepEqual(canaryRegistryBytes(c.historicalRegistry),before);assert.equal(auditScreeningEvidence(input(c)).comparisonEligible,true);const d=structuredClone(c);d.newOutputRegistry.privateRegistrySHA256='d'.repeat(64);assert.notEqual(hash(canaryRegistryBytes(c)),hash(canaryRegistryBytes(d)));});
for(const [label,mutate] of [
 ['unknown key',c=>c.extra=true],['nested component',c=>c.newOutputRegistry=composite()],['empty component',c=>c.newOutputRegistry.entries=[]],['wrong fresh campaign',c=>c.newOutputRegistry.campaignId='other'],['same old campaign',c=>{c.campaignId='old';c.newOutputRegistry.campaignId='old';}],['cross artifact duplicate',c=>c.newOutputRegistry.entries[0].artifactId='old-output'],['cross marker duplicate',c=>c.newOutputRegistry.entries[0].canarySHA256=c.historicalRegistry.entries[0].canarySHA256],['reused historical cell',c=>c.newOutputRegistry.entries[0].cellId='old-cell'],['new grader',c=>{c.newOutputRegistry.entries[0].role='grader';c.newOutputRegistry.entries[0].cellId=null;}],['solver scope',c=>c.newOutputRegistry.entries[0].authorizedScopes=[{role:'solver',phase:'solve',cellId:'new-cell'}]],['missing historical grader',c=>c.historicalRegistry.entries.shift()],['total union bound',c=>{c.historicalRegistry.entries=Array.from({length:256},(_,i)=>({artifactId:'g'+i,role:'grader',cellId:null,canarySHA256:hash('g'+i),authorizedScopes:structuredClone(scopes)}));}]
])test('reject '+label,()=>{const c=composite();mutate(c);assert.throws(()=>canaryRegistryBytes(c));});
for(const c of ['a','b','c'])test('detect retained historical/fresh marker '+c,()=>{const r=auditScreeningEvidence(input(composite(),marker(c)));assert.equal(r.assessment,'contamination-detected');assert.equal(r.comparisonEligible,false);});
test('unknown marker remains inconclusive',()=>assert.equal(auditScreeningEvidence(input(composite(),marker('f'))).assessment,'inconclusive'));
test('missing current-cell output blocked',()=>{const x=input();x.cellId='missing';assert.throws(()=>auditScreeningEvidence(x),/missing cell output/);});
test('evidence incompleteness retained',()=>{const x=input();x.sources[0].complete=false;assert.equal(auditScreeningEvidence(x).comparisonEligible,false);});
test('report tampering rejected',()=>{const x=input(),report=auditScreeningEvidence(x);report.comparisonEligible=false;assert.throws(()=>verifyScreeningAudit({...x,report}));});
test('component tampering invalidates bound registry',()=>{const x=input();x.registry.historicalRegistry.entries[0].canarySHA256='e'.repeat(64);assert.throws(()=>auditScreeningEvidence(x),/commitment mismatch/);});

test('historical cell cannot become eligible under fresh composite',()=>{const x=input();x.cellId='old-cell';for(const source of x.sources)source.scope.cellId='old-cell';assert.throws(()=>auditScreeningEvidence(x),/missing cell output/);});
for(const [label,mutate] of [
 ['duplicate fresh cell',c=>{const e=structuredClone(c.newOutputRegistry.entries[0]);e.artifactId='another';e.canarySHA256=hash('another');c.newOutputRegistry.entries.push(e);}],
 ['coordinator solve scope',c=>c.newOutputRegistry.entries[0].authorizedScopes=[{role:'coordinator',phase:'solve',cellId:null}]],
 ['coordinator cell scope',c=>c.newOutputRegistry.entries[0].authorizedScopes=[{role:'coordinator',phase:'audit',cellId:'new-cell'}]]
])test('reject '+label,()=>{const c=composite();mutate(c);assert.throws(()=>canaryRegistryBytes(c));});
test('historical canonical bytes match independently retained expected fixture',()=>{
 const expected=publicCanaryRegistry(priv('old',[art('grader','grader',null,'a'),art('old-output','run-output','old-cell','b')]));
 const retained=canaryRegistryBytes(expected);const c=composite();canaryRegistryBytes(c);auditScreeningEvidence(input(c));assert.deepEqual(canaryRegistryBytes(c.historicalRegistry),retained);
});
