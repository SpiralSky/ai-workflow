export interface FileIdentity {sha256:string;bytes:number;mode:number}
export function inventory(root:string, limits?:{maxFiles?:number;maxBytes?:number}):Record<string,FileIdentity>;
export function assertPermittedDelta(before:Record<string,FileIdentity>,after:Record<string,FileIdentity>,allowed:Iterable<string>):void;
export class Journal {constructor(dir:string);dir:string;append(event:unknown):{sequence:number;sha256:string}}
export function readBounded(file:string,maxBytes?:number):Buffer;
