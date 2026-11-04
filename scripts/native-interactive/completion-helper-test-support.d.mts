export function captureThroughFixedHelpers(f:{base?:string;cellDir:string},sequence:number,raw:Buffer):Promise<void>;
export function finalizeFixedHelperRelay(f:{base?:string;cellDir:string},sequence:number):Promise<void>;
export function awaitFixedHelperRelay(f:{base?:string;cellDir:string},sequence:number):Promise<void>;

export function createFixedTransportTestBinding(options:{cellDir:string;arm:string;cellId?:string;limitsSHA256:string}):import('./native-completion.mjs').NativeBinding;
