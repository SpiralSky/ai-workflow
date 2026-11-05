import type { LLMClient } from '@aiw/telemetry';
export interface NativeBinding {sourceSHA256:string;admissionSHA256:string;cellId:string;arm:string;limitsSHA256:string}
export interface NativeCompletionReceipt {completionId:string;requestSHA256:string;responseSHA256:string}
export interface NativeEvidenceFile {path:string;bytes:number;sha256:string;kind:string}
export interface NativeCompletionEvidence {version:string;binding:NativeBinding;attempts:number;accepted:NativeCompletionReceipt[];files:NativeEvidenceFile[];summary:Record<string,unknown>;input:null;output:null;costUsd:null}
export const NATIVE_COMPLETION_LIMITS:Readonly<{attempts:number;frameBytes:number;totalBytes:number;requestMs:300000;depth:number;sourceBytes:number;calls:number}>;
export function encodeNative(value:unknown):Buffer;
export function parseNativeCompletionFrame(raw:Buffer,maxBytes?:number):any;
export function nativeKeys(value:unknown,required:string[],optional?:string[]):void;
export function validateNativeBinding(binding:NativeBinding):NativeBinding;
export function nativeCompletionPaths(cellDir:string,sequence:number):Record<string,string>;
export function writeNativeExclusive(file:string,raw:Buffer):void;
export function validateNativeCompletionResponse(frame:unknown,request:unknown):any;
export function nativeFileEvidence(file:string,max?:number):NativeEvidenceFile;
export function verifyNativeCompletionEvidence(options:{cellDir:string;binding:NativeBinding;requireComplete?:boolean}):NativeCompletionEvidence;
export function createNativeCompletionBridge(options:{cellDir:string;binding:NativeBinding;issueCapability:(reservation:any)=>Promise<string>;emitRequest:(raw:Buffer)=>Promise<void>|void;onFatal:(error:Error)=>void;checkActive:()=>void;limits?:Partial<Record<keyof typeof NATIVE_COMPLETION_LIMITS,number>>}):{client:LLMClient;readonly failed:boolean;readonly fatalReason:string|null;open():void;close():NativeCompletionEvidence;beginAction(sequence:number,remainingMs:number):void;endAction():void;accept(raw:Buffer):NativeCompletionReceipt;summary():Record<string,unknown>;verifyComplete():NativeCompletionEvidence};

export class NativeClockSamplingError extends Error {constructor(uptimeMs:number,samplingSkewMs:number);}
export function nativeSharedClock():{bootId:string;uptimeMs:number;wallMs:number;wallUpperMs:number;samplingSkewMs:number};
export function verifyNativeCompletionLifetime(options:{cellDir:string;sequence:number}):unknown;
export function assertNativeCompletionActive(options:{cellDir:string;sequence:number}):number;

export const NATIVE_COMPLETION_CLOCK_POLICY:Readonly<{version:string;namespaceIdentity:string;samplingSkewMs:number;precisionMarginMs:number;maxElapsedDriftMs:number;scope:string}>;
export function nativeRemainingLifetime(lease:any,clock:any):number;
