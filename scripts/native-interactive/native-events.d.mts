import type {NativeBinding,NativeCompletionEvidence,NativeEvidenceFile} from './native-completion.mjs';
export const NATIVE_EVENT_LIMITS:Readonly<{eventBytes:number;events:number;totalBytes:number}>;
export interface NativeEventEvidence {version:string;files:NativeEvidenceFile[];summary:Record<string,unknown>;completionIds:string[];eventCount:number;totalBytes:number;input:null;output:null;costUsd:null}
export function verifyNativeEventEvidence(options:{cellDir:string;binding:NativeBinding;completionEvidence:NativeCompletionEvidence;requireComplete?:boolean}):NativeEventEvidence;
export function createNativeEventSink(options:{cellDir:string;binding:NativeBinding;onFatal:(error:Error)=>void;completionEvidence:()=>NativeCompletionEvidence}):{write(event:unknown):void;close():NativeEventEvidence;verifyComplete():NativeEventEvidence;summary():Record<string,unknown>;readonly failed:boolean;readonly fatalReason:string|null};

export function validateNativeReporterEvent(event:unknown):unknown;
