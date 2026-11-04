export const FIXED_COMPLETION_TRANSPORT_LIMITS:Readonly<{frameBytes:number;totalOutputBytes:number;observationBytes:number;totalEvidenceBytes:number;helperMs:number;cleanupMs:number;stderrBytes:number;nominalActorSubcalls:number;nominalParentSubcalls:number}>;
export const FIXED_COMPLETION_TRANSPORT_SCOPE:string;
export const TRANSPORT_READY:Buffer;
export const TRANSPORT_VERDICT:Buffer;
export const TRANSPORT_STAGES:readonly string[];
export function completionTransportPaths(cellDir:string,sequence:number):Record<string,string>;
export function completionTransportIdentity():Record<string,string>;
export function strictTransportUTF8(value:string,max?:number):Buffer;
export function completionTransportCommand(options:{cellDir:string;sequence:number;mode:string}):string;
export function completionTransportLaunch(options:{cellDir:string;sequence:number}):Buffer;
export function composeCompletionTransport(options:{cellDir:string;sequence:number}):Buffer;
export function failCompletionTransport(options:{cellDir:string;sequence:number;reason?:string}):void;
export function verifyCompletionTransport(options:{cellDir:string;sequence:number;through?:string;raw?:Buffer}):{files:Array<{path:string;kind:string;bytes:number;sha256:string}>;outputBytes:number;retainedBytes:number;scope:string};
export function validateTransportObservation(options:{cellDir:string;sequence:number;stage:string;observation:unknown}):Record<string,unknown>;
interface TransportOptions {cellDir:string;sequence:number;signal?:AbortSignal;emit:(raw:Buffer)=>Promise<{bytes:number;sha256:string}>}
export function bootstrapCompletionTransport(options:TransportOptions):Promise<{bytes:number;sha256:string}>;
export function captureCompletionTransport(options:TransportOptions & {input:NodeJS.ReadableStream}):Promise<{bytes:number;sha256:string}>;
export function observeCompletionTransport(options:TransportOptions & {stage:string;input:NodeJS.ReadableStream}):Promise<unknown>;
export function readCompletionTransport(options:TransportOptions):Promise<{bytes:number;sha256:string}>;

export const TRANSPORT_CAPTURE_STATUS:string;
export const TRANSPORT_READER_STATUS:string;

export function completionTransportSourceBindings():Record<string,string>;
