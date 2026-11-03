import type {HandoffBindings,HandoffManifest} from './handoff.mjs';
import type {BootstrapCapability,BootstrapReceipt} from './bootstrap.mjs';
export interface PublicHandoffDescription {bootstrapCommand:string;bootstrapInstruction:string;requestedOutputTokens:number;cellDir:string;handoffSHA256:string;handoffBytes:number;capabilitySHA256:string;capabilityPath:string;manifestSHA256:string;expectedBootstrapOutputBytes:number;expectedBootstrapOutputSHA256:string;templateSHA256:string;taskSHA256:string;readySHA256:string;bindings:HandoffBindings;evidenceScope:string}
export function publicHandoffPolicy():unknown;
export function prepareCellPublicHandoff(options:{cellDir:string}):PublicHandoffDescription;
export function verifyCellPublicHandoff(options:{cellDir:string}):PublicHandoffDescription;
export function readCellPublicHandoff(options:{cellDir:string}):{payload:Buffer;manifest:HandoffManifest;manifestBytes:Buffer;capability:BootstrapCapability;capabilityBytes:Buffer;capabilitySHA256:string;handoffSHA256:string;bindings:HandoffBindings};
export function readCellBootstrapReceipt(options:{cellDir:string}):{description:PublicHandoffDescription;receipt:BootstrapReceipt;receiptSHA256:string;attemptSHA256:string};
