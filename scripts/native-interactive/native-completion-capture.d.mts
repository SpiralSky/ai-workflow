export const NATIVE_COMPLETION_CAPTURE_LIMITS:Readonly<{inputBytes:number;outputBytes:number;timeoutMs:number}>;
export const NATIVE_COMPLETION_READY:Buffer;
export function completionCapturePaths(cellDir:string,sequence:number):Record<string,string>;
export function completionCaptureCommand(options:{cellDir:string;sequence:number;node?:string}):string;
export function captureNativeCompletion(options:{cellDir:string;sequence:number;input:NodeJS.ReadableStream;emit:(raw:Buffer)=>Promise<{bytes:number;sha256:string}>;onReady:(raw:Buffer)=>Promise<{bytes:number;sha256:string}>;signal?:AbortSignal;clock?:any}):Promise<unknown>;
export function verifyCapturedNativeCompletion(options:{cellDir:string;sequence:number;raw:Buffer}):unknown;

export function recordNativeCompletionCaptureExit(options:{cellDir:string;sequence:number;output:Buffer;exitCode:number|null;signal:string|null}):unknown;

export function configureNativeCompletionTerminal(options?:{inputTTY?:boolean;outputTTY?:boolean;run?:typeof import('node:child_process').spawnSync;diagnostic?:(raw:Buffer)=>unknown}):void;

export function verifyDeliveredNativeCompletion(options:{cellDir:string;sequence:number;raw:Buffer}):unknown;

export function verifyCapturedNativeCompletionFiles(options:{cellDir:string;sequence:number;raw:Buffer}):unknown;
