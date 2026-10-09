// effects (paths are relative to the workspace)
declare function bash(cmd: string, opts?: { timeoutMs?: number }): Promise<{ code: number; out: string }>;
declare function readFile(path: string): Promise<string>;
declare function readSymbol(path: string, name: string): Promise<string>; // one function/class source
declare function findFiles(glob: string): Promise<string[]>;
declare function edit(path: string, oldStr: string, newStr: string): Promise<void>; // oldStr must occur exactly once
declare function writeFile(path: string, content: string): Promise<void>; // new files only
declare function runTests(filter?: string): Promise<{ ok: boolean; failures: string }>;
// decisions (cheap model; use for fuzzy judgments only, prefer exit codes / string checks)
declare function check(text: string, question: string): Promise<boolean>;
declare function classify<L extends string>(text: string, labels: Record<L, string>): Promise<L>;
// models (fresh sub-call: sees ONLY prompt + ctx, not this conversation — pass what it needs)
declare function weakLLM(prompt: string, opts?: { ctx?: unknown[] }): Promise<string>;
declare function llm(prompt: string, opts?: { ctx?: unknown[] }): Promise<string>;
// control
declare function parallel<T extends readonly unknown[]>(...ps: T): Promise<{ [K in keyof T]: Awaited<T[K]> }>;
declare function returnUser(message: string): never; // ends the turn; message goes to the user, not to you
declare function getHandle(id: string): string;     // full value of a truncated result ($hN)
declare const state: Record<string, unknown>;        // persists across branch calls this session
