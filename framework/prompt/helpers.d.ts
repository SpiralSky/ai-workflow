// effects (paths are relative to the workspace)
declare function bash(cmd: string, opts?: { timeoutMs?: number }): Promise<{ code: number; out: string }>; // timeout kills the process group (code -1); output keeps the last ~200k chars
declare function readFile(path: string): Promise<string>;
declare function readSymbol(path: string, name: string): Promise<string>; // one function/class source
declare function findFiles(glob: string): Promise<string[]>;
declare function edit(path: string, oldStr: string, newStr: string): Promise<void>; // oldStr must occur exactly once
declare function writeFile(path: string, content: string): Promise<void>; // new files only
declare function runTests(filter?: string): Promise<{ ok: boolean; failures: string }>; // filter only applies to python unittest (-k); ignored for npm; failures = output tail
// decisions (cheap model; use for fuzzy judgments only, prefer exit codes / string checks)
declare function check(text: string, question: string): Promise<boolean>; // text truncated to 12k chars
declare function classify<L extends string>(text: string, labels: Record<L, string>): Promise<L>; // text is truncated to the first 12k chars
// models (fresh sub-call: sees ONLY prompt + ctx, not this conversation — pass what it needs)
declare function weakLLM(prompt: string, opts?: { ctx?: unknown[] }): Promise<string>;
declare function llm(prompt: string, opts?: { ctx?: unknown[] }): Promise<string>;
// tools — call any Claude Code built-in tool by name
declare function tool(name: "Bash", input: { command: string; timeout?: number }): Promise<string>;
declare function tool(name: "Read", input: { file_path: string }): Promise<string>;
declare function tool(name: "Write", input: { file_path: string; content: string }): Promise<string>;
declare function tool(name: "Edit", input: { file_path: string; old_string: string; new_string: string }): Promise<string>;
declare function tool(name: "Glob", input: { pattern: string }): Promise<string>; // returns JSON array of paths
declare function tool(name: "Grep", input: { pattern: string; path?: string }): Promise<string>;
declare function tool(name: "WebFetch", input: { url: string }): Promise<string>;
declare function tool(name: string, input: Record<string, unknown>): Promise<string>;
// control
declare function parallel<T extends readonly unknown[]>(...ps: T): Promise<{ [K in keyof T]: Awaited<T[K]> }>;
declare function returnUser(message: string): never; // ends the turn; message goes to the user, not to you
declare function getHandle(id: string): string;     // full value of a truncated result ($hN)
declare const state: Record<string, unknown>;        // persists across branch calls; must be structured-cloneable (no functions); lost if the branch times out
