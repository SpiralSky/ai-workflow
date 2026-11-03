import fs from 'node:fs';
import path from 'node:path';
import {inspectPublicAdmissionInputs} from './public-admission.mjs';
import {inventory,readBounded} from './files.mjs';
import {digest,ARMS} from './protocol.mjs';

export const SCREENING_MODE='cooperative-screening-v1';
/** Explicit opt-in; a missing mode always retains the historical full admission gate. */
export function admissionMode(value='full'){if(!['full',SCREENING_MODE].includes(value))throw Error('invalid admission mode');return value;}
/** Bind procedural controls without copying private marker literals into public admission. */
export function validateScreeningControls(value){
 if(!value||Object.keys(value).sort().join(',')!=='auditCoverage,canaryRegistrySHA256,coordinatorTarget,privateAbsenceSHA256,runtimeClosureSHA256,version'||value.version!==1)throw Error('screening controls required');
 for(const key of ['canaryRegistrySHA256','privateAbsenceSHA256','runtimeClosureSHA256'])if(!/^[a-f0-9]{64}$/.test(value[key]))throw Error('invalid screening control commitment');
 if(value.auditCoverage!=='relay-and-observed-native-tools-only'||typeof value.coordinatorTarget!=='string'||!/^\/root(?:\/[a-z0-9_]+)*$/.test(value.coordinatorTarget))throw Error('invalid screening audit or coordinator');
 return JSON.parse(JSON.stringify(value));
}
/** Public committed bytes only. Neither private files nor optional hotpath code are read here. */
export function screeningSourceEvidence(root){
 const publicInputs=inspectPublicAdmissionInputs(root);
 return {bindings:Object.fromEntries(Object.entries(publicInputs.sources).map(([p,e])=>[p,e.sha256])),publicSourceIdentity:{commit:publicInputs.commit,tree:publicInputs.tree,sourceIdentitySHA256:publicInputs.sourceIdentitySHA256}};
}
/** A campaign binds the optional candidate only when that candidate is actually selected. */
export function screeningArms(arms){if(!Array.isArray(arms)||!arms.length||arms.some(a=>!ARMS.includes(a)))throw Error('invalid screening arms');return [...new Set(arms)].sort();}
/** Post-solve private-source identity. Files stay outside the public checkout, not outside same-user reach. */
export function inspectPrivateGrader(root,publicRoot){
 if(typeof root!=='string'||!path.isAbsolute(root)||path.resolve(root)!==root||fs.realpathSync(root)!==root||root===publicRoot||root.startsWith(publicRoot+path.sep))throw Error('external canonical private grader required');
 const files=inventory(root,{maxFiles:200,maxBytes:8388608});
 if(Object.getPrototypeOf(files)!==Object.prototype||!files['grade.py']||!files['manifest.json'])throw Error('incomplete private grading inputs');
 const manifest=JSON.parse(readBounded(path.join(root,'manifest.json'),65536));
 if(!Array.isArray(manifest.fixtures)||!manifest.fixtures.length)throw Error('invalid private fixture manifest');
 return {root,sha256:digest(files),files};
}
/** Preserve a candid limit in every cooperative result, independently of grading outcome. */
export function screeningLimitations(){return ['Limited cooperative screening, not proof of improvement','Same OS user can reach restored grading data while submitted code executes','Private-file absence and actor restrictions are procedural, not enforced isolation','Relay logs and observed native calls are partial; canary absence cannot prove no leakage','Visible bytes and measured supervisor duration are not token, cache, billing, or model-latency measurements'];}
