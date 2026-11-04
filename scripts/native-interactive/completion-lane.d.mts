import type {NativeBinding} from './native-completion.mjs';
export const COMPLETION_TRANSPORT_LIMITS:Readonly<{frameBytes:number;laneBytes:number;inputBytes:number;outputBytes:number;terminalReserveBytes:number}>;
export const NATIVE_LIMITS_MANIFEST:Readonly<Record<string,Readonly<Record<string,number|string>>>>;
export function completionBinding(admission:{bindings:unknown;arm:string},admissionSHA256:string,cellId:string):NativeBinding;
export function createCompletionFramer(options?:{maxBytes?:number;totalBytes?:number}):{push(chunk:Buffer):Buffer|null;eof():void;readonly total:number;readonly pending:boolean;readonly retained:Buffer};
export function createSupervisorCompletionLane(options:any):{beginAction(action:any):void;endAction():void;worker(raw:Buffer):Promise<void>;response(raw:Buffer):Promise<void>;assertComplete():any;readonly snapshot:any};

export function createCompletionIPCFramer():{push(chunk:Buffer):Buffer[];eof():void;readonly total:number;readonly retained:Buffer};

export function encodeFinalSubmissionFrame(submission:unknown,supervision:{transportOutputBytes:number}):Buffer;
