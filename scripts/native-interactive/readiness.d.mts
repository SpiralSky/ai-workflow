export interface LinuxProcessIdentity {pid:number;parentPid:number;processGroupId:number;startTimeTicks:string;state:string;pidNamespace:string;mountNamespace:string;timeNamespace:string|null;bootId:string}
export function readLinuxProcessIdentity(pid:number,options?:{readText?:(path:string,max:number)=>string;readlink?:(path:string)=>string}):LinuxProcessIdentity;
export function verifyReadyLiveness(evidence:{start:unknown;ready:unknown},options?:{now?:()=>number;readIdentity?:(pid:number)=>LinuxProcessIdentity;currentPID?:number}):{status:'live';observedMonotonicMs:number;observedAtUTC:string;deadlineMonotonicMs:number;remainingMs:number;clockScope:string;scope:string;observer:LinuxProcessIdentity;supervisor:LinuxProcessIdentity;worker:LinuxProcessIdentity};

export function identityKey(identity:LinuxProcessIdentity):string;
