import type {ObservationClock} from './controller.mjs';
import type {HandoffManifest,ByteDigest} from './handoff.mjs';
export interface BootstrapCapability {version:1;kind:'public-bootstrap-capability';cellDir:string;handoffPath:string;manifestPath:string;manifestBytes:number;manifestSHA256:string;manifest:HandoffManifest}
export interface BootstrapReceipt {version:1;kind:'public-bootstrap-receipt';status:'emitted';dispatchIntentSHA256:string;capabilitySHA256:string;capabilityBytes:number;manifestSHA256:string;manifestBytes:number;manifest:HandoffManifest;attemptSHA256:string;expectedPayload:ByteDigest;expectedOutput:ByteDigest;emittedPayload:ByteDigest;emittedOutput:ByteDigest;scope:string}
export function generateBootstrapCapability(options:{cellDir:string;manifest:HandoffManifest;manifestBytes:Buffer}):{capability:BootstrapCapability;bytes:Buffer;sha256:string};
export function generateBootstrapOutput(options:{payload:Buffer;manifest:HandoffManifest;capabilitySHA256:string}):Buffer;
export const formatBootstrapOutput:typeof generateBootstrapOutput;
export function verifyBootstrapOutput(options:{output:Buffer;payload:Buffer;manifest:HandoffManifest;capabilitySHA256:string}):unknown;
export function runPublicBootstrap(options:{capabilityPath:string;expectedCapabilitySHA256:string;emit?:(output:Buffer,options:{signal:AbortSignal})=>Promise<ByteDigest>;clock?:ObservationClock}):Promise<BootstrapReceipt>;
export function verifyBootstrapReceipt(options:{receipt:unknown;manifest:HandoffManifest;capability:BootstrapCapability;capabilitySHA256:string;payload:Buffer;dispatchIntentSHA256:string}):BootstrapReceipt;
