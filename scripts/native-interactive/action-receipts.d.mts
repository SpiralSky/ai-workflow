import type {ARMS,Action} from './protocol.mjs';
export const RECEIPT_LIMITS:Readonly<{frameBytes:4096;totalBytes:49152}>;
export type ReceiptBindings=Readonly<{assignmentSHA256:string;admissionSHA256:string;configSHA256:string;supervisorStartSHA256:string;dispatchIntentSHA256:string}>;
export type ActionReservation=ReceiptBindings & Readonly<{version:'native-action-reservation-v1';sequence:number;actionKind:Action['kind'];inputSHA256:string;inputBytes:number}>;
export type ActionReceipt=Omit<ActionReservation,'version'> & Readonly<{kind:'coordinator-action-receipt';version:'native-action-receipt-v1';scope:string;feedbackSHA256:string;feedbackBytes:number}>;
export type ActionAcknowledgement=Readonly<{version:'native-action-ack-v1';sequence:number;receiptSHA256:string;receiptBytes:number;feedbackSHA256:string;feedbackBytes:number;outputBytes:number}>;
export type ReceiptSnapshot=Readonly<{receivedCount:number;acknowledgedCount:number;receiptOutputBytes:number;feedbackOutputBytes:number;submitted:boolean;pending:number|null;failed:boolean}>;
export function createActionReceiptTracker(options:{arm:typeof ARMS[number];bindings:ReceiptBindings;checkActive:()=>void;persistInput:(record:ActionReservation,raw:Buffer)=>void;persistFeedback:(record:ActionReceipt,raw:Buffer)=>void;emit:(receiptFrame:Buffer,rawFeedbackFrame:Buffer)=>Promise<void>;persistAck:(record:ActionAcknowledgement)=>void}):Readonly<{
 readonly snapshot:ReceiptSnapshot;
 input(chunk:Buffer):Buffer|null;
 feedback(chunk:Buffer):Promise<void>;
 inputEOF():void;
 feedbackEOF():void;
 assertComplete():ReceiptSnapshot;
}>;
