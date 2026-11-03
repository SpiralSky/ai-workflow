export const HANDOFF_LIMITS:Readonly<{taskBytes:32768;readyBytes:number;payloadBytes:number;metadataBytes:16384}>;
export const PUBLIC_HANDOFF_TEMPLATE:string;
export interface HandoffBindings {cellDir:string;campaignSHA256:string;cellIndex:number;cellId:string;fixtureId:string;arm:'direct'|'branch-expanded'|'branch-hotpath2';sourceBindingSHA256:string;assignmentSHA256:string;admissionSHA256:string;protocolSHA256:string}
export interface ByteDigest {bytes:number;sha256:string}
export interface HandoffManifest {version:1;kind:'public-handoff';bindings:HandoffBindings;cellSHA256:string;template:ByteDigest;task:ByteDigest & {offset:number};readyFrame:ByteDigest & {offset:number};payload:ByteDigest}
export function exactKeys(value:unknown,keys:string[],label:string):void;
export function validateHandoffBindings(bindings:HandoffBindings):HandoffBindings;
export function generatePublicHandoff(options:{task:Buffer;readyFrame:Buffer;bindings:HandoffBindings}):{payload:Buffer;manifest:HandoffManifest};
export function verifyPublicHandoff(options:{payload:Buffer;task:Buffer;readyFrame:Buffer;manifest:HandoffManifest;bindings:HandoffBindings}):HandoffManifest;
export function parsePublicHandoff(options:{payload:Buffer;manifest:HandoffManifest;bindings:HandoffBindings}):{task:Buffer;readyFrame:Buffer};
