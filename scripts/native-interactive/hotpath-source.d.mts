export const HOTPATH_COMMIT:string;export const HOTPATH_TREE:string;export const HOTPATH_ROOT:string;
export function inspectRuntime(root:string,commit:string,tree:string):{commit:string;tree:string;nodeVersion:string;source:Record<string,string>;dependencies:Record<string,unknown>};
export function hotpathBinding():ReturnType<typeof inspectRuntime>;

export function assertFlatSourceResolution(root:string,paths:string[]):void;
