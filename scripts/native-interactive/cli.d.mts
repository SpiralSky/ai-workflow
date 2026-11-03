import type {Readable,Writable} from 'node:stream';
import type {ObservationClock} from './controller.mjs';
export interface CellConfig {arm:'direct'|'branch-expanded'|'branch-hotpath2';root:string;allowedWritePaths:string[];venv:string;journalDir:string;cellDir:string}
export const BOUNDS:Readonly<{wallMs:number;inputBytes:number;outputBytes:number;stderrBytes:number}>;
export function readConfig(file:string):CellConfig;
export function validateConfig(config:unknown):CellConfig;
export function sanitizedEnv(config:Pick<CellConfig,'venv'>,temp:string,runtime?:import('./check-runtime.mjs').CheckRuntime):NodeJS.ProcessEnv;
export function writeStream(stream:Writable,data:string|Buffer):Promise<void>;
export function supervise(config:CellConfig,io?:{input?:Readable;stdout?:(data:Buffer|string)=>unknown|Promise<unknown>;stderr?:(data:Buffer)=>unknown|Promise<unknown>;clock?:ObservationClock;recordDispatchIntent?:(options:{cellDir:string;actorId:string;assignmentSHA256:string;handoffSHA256:string;capabilitySHA256:string})=>unknown|Promise<unknown>}):Promise<{status:'submitted'|'incomplete';cleanup:'closed'|'uncertain';configSHA256:string;admissionSHA256:string;outcome?:unknown;reason?:string;bytesIn:number;bytesOut:number;coordinatorInputBytes:number;coordinatorOutputBytes:number;coordinatorControls:number;coordinatorActionReceiptBytes:number;actionReceipts?:import('./action-receipts.mjs').ReceiptSnapshot;timing:{scope:string;startedMonotonicMs:number;endedMonotonicMs:number;elapsedMs:number;startedAtUTC:string;assignmentLimitMs:number;observations:Array<{type:string;monotonicMs:number;observedAtUTC:string}>}}>;

export function awaitGroupExit(pid:number,deadline:number,options?:{inspect?:(pid:number)=>unknown;probe?:(pid:number)=>boolean;now?:()=>number;sleep?:(ms:number)=>Promise<void>}):Promise<{absent:boolean;observations:Array<{at:number;present:boolean}>}>;

export {readLinuxProcessIdentity,verifyReadyLiveness} from './readiness.mjs';
export type {LinuxProcessIdentity} from './readiness.mjs';

export const COORDINATOR_CONTROL_BYTES:4096;
export function parseCoordinatorDispatchControl(frame:string|Buffer,expected:{actorId:string;assignmentSHA256:string;handoffSHA256:string;capabilitySHA256:string}):{kind:'coordinator-dispatch-intent';actorId:string;assignmentSHA256:string;handoffSHA256:string;capabilitySHA256:string};

export function createReadyFrameForwarder(options:{persist:(frame:Buffer)=>unknown|Promise<unknown>;emit:(bytes:Buffer)=>unknown|Promise<unknown>;onReady:(frame:Buffer)=>unknown|Promise<unknown>}):(chunk:Buffer)=>Promise<void>;
