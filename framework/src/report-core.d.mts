export type Snapshot = Map<string, string>;
export interface FileChange { path: string; added: number; deleted: number }
export function snapshot(cwd: string): Snapshot;
export function lineDiff(a: string, b: string): { added: number; deleted: number };
export function diffSnapshots(before: Snapshot, after: Snapshot): FileChange[];
export function formatAuto(changes: FileChange[], tests?: boolean): string;
export function traceDir(): string;
export function recordTests(cwd: string, ok: boolean): void;
export function saveSnapshot(sid: string, cwd: string): void;
export function takeReport(sid: string, cwd: string, force?: boolean): string | undefined;
