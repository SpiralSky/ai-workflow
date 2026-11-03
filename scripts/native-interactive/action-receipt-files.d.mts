export function createActionReceiptStore(options:{cellDir:string}):{
 persistInput(record:{sequence:number},raw:Buffer):void;
 persistFeedback(record:{sequence:number},raw:Buffer):void;
 persistAck(record:{sequence:number}):void;
};
export function validateActionReceiptEvidence(options:{cellDir:string;supervision:any}):{count:number;inputBytes:number;receiptBytes:number;feedbackBytes:number;identitySHA256:string;scope:string};
