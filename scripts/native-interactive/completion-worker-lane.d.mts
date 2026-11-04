import type {Duplex} from 'node:stream';
import type {NativeBinding,NativeCompletionEvidence} from './native-completion.mjs';
export function createWorkerCompletionLane(options:{binding:NativeBinding;onFatal:(error:Error)=>void;accept:(raw:Buffer)=>unknown;stream?:Duplex}):{issueCapability(reservation:unknown):Promise<string>;emitRequest(raw:Buffer):Promise<void>;notifyFatal(error:unknown):Promise<void>;close(evidence:{completion:{summary:unknown};event:{summary:unknown}}):Promise<void>;destroy():void;readonly failed:boolean;readonly closed:boolean};
