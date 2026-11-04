export function generateNativeCompletionBootstrap(raw:Buffer):Buffer;
export function completionBootstrapCommand(options:{cellDir:string;sequence:number;node?:string}):string;
export function runNativeCompletionBootstrap(options:{cellDir:string;sequence:number;emit:(raw:Buffer)=>Promise<{bytes:number;sha256:string}>;signal?:AbortSignal}):Promise<unknown>;
export function recordNativeCompletionBootstrapExit(options:{cellDir:string;sequence:number;output:Buffer;exitCode:number|null;signal:string|null}):{outputBytes:number;outputSHA256:string;requestSHA256:string};
export function verifyNativeCompletionBootstrap(options:{cellDir:string;sequence:number}):{outputBytes:number;outputSHA256:string;requestSHA256:string};

export const NATIVE_COMPLETION_BOOTSTRAP_LIMITS:Readonly<{frameBytes:number;totalBytes:number;timeoutMs:number}>;
