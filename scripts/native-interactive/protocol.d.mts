export const PROTOCOL_VERSION:'native-interactive-action-receipt-v3';
export const LIMITS:Readonly<{assignmentMs:900000;actionMs:60000;rounds:12;hostCalls:60;lineBytes:98304;sourceBytes:32768;feedbackBytes:1048576}>;
export const ARMS:readonly ['direct','branch-expanded','branch-hotpath2'];
export function monotonicNow():number;
export function digest(value:unknown):string;
export type Action={sequence:number;kind:'submit'}|{sequence:number;kind:'tools';calls:Array<{name:string;args:Record<string,unknown>}>}|{sequence:number;kind:'branch';code:string};
export function parseAction(line:string,arm:typeof ARMS[number],expectedSequence:number):Action;
export function boundedLines(stream:AsyncIterable<string|Buffer>,max?:number):AsyncGenerator<string>;
export class Ledger {
 constructor(arm:typeof ARMS[number]);
 readonly events:readonly unknown[];
 arm:typeof ARMS[number];sequence:number;calls:number;feedback:number;state:string;
 reserve(line:string):Action;
 hostAttempt(name:string,args:unknown):void;
 finish(result:unknown,submitted?:boolean):void;
 fail(reason:unknown):void;
}
