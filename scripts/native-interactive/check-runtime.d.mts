export interface CheckRuntime {mode:string;venv:string;node:{path:string;sha256:string;bytes:number;mode:number};pyright:{version:string;entry:string;bundle:{sha256:string;files:number;bytes:number}};sourceRoot:string;sources:Record<string,{sha256:string;bytes:number;mode:number}>}
export function verifiedNode(executable?:string):string;
export function nativeCheckEnv(config:{venv:string},temp:string,runtime?:CheckRuntime):NodeJS.ProcessEnv;
export function inspectCheckRuntime(venv:string,temp:string,expected?:CheckRuntime,timeoutMs?:number):CheckRuntime;

export function checkRuntimePolicy():{mode:string;lockSHA256:string};
export function verifyCellCheckRuntime(options:{cellDir:string;admission:any;supervision:any}):string;
