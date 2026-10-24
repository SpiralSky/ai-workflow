import test from "node:test";
import assert from "node:assert/strict";
import { compileBranch, renderTrace, runBranch, type BranchTools, type CompiledBranch } from "../src/index.ts";

const tools: BranchTools = {
  bash: async (args) => (String(args.cmd).includes("/") ? { code: 0, out: "/home/user/happy.py" } : { code: 0, out: "" }),
  readFile: async (args) => {
    if (args.path === "cfg.json") throw new Error("ENOENT: no such file or directory");
    return "text";
  },
};

/** Compiles, runs and renders `source` in trace mode. */
async function run(source: string, state: Record<string, unknown> = {}) {
  const c = compileBranch(source);
  assert.ok(!("error" in c), "compiles");
  const result = await runBranch(c as CompiledBranch, tools, state);
  return { result, text: renderTrace(result, { mode: "trace", source, state }) };
}

test("BF §7.3 example: lines, cond text, return and footer end to end", async () => {
  const { result, text } = await run(`async (tools, state) => {
  // find the file
  let result = await tools.bash({ cmd: "find . -name happy.py" });
  if (!result.out.trim()) {
    result = await tools.bash({ cmd: "find / -name happy.py" });
  }
  state.path = result.out;
  return { found: true, path: result.out };
}`);
  assert.ok(result.ok);
  const lines = text.split("\n");
  assert.match(lines[0], /^L3 +bash\(\{cmd:"find \. -name happy\.py"\}\) → \{code:0, out:""\} \(\d+ms\)$/);
  assert.match(lines[1], /^L4 +if \(!result\.out\.trim\(\)\) → true$/);
  assert.match(lines[2], /^L5 +bash\(/);
  assert.match(lines[3], /^L8 +return \{found:true, path:"\/home\/user\/happy\.py"\}$/);
  assert.match(lines[4], /^state: path\(string, \d+B\)$/);
});

test("uncaught tool error maps to the call line with a stack", async () => {
  const { result, text } = await run(`async (tools) => {
  const load = async (p: string) => {
    return await tools.readFile({ path: p });
  };
  return await load("cfg.json");
}`);
  assert.ok(!result.ok && result.error === "thrown" && result.line === 3);
  assert.match(text, /L3 +readFile\(\{path:"cfg\.json"\}\) ✗ ENOENT/);
  assert.match(text, /at L3 ← L5/);
});

test("loop over many files collapses with distinct errors", async () => {
  const { text } = await run(`async (tools) => {
  const out: string[] = [];
  for (const p of ["a", "cfg.json", "b", "c", "cfg.json"]) {
    try { out.push(await tools.readFile({ path: p })); } catch (e) { out.push("x"); }
  }
  return out.length;
}`);
  assert.match(text, /L3–5 +for ×5 \(3 ok, 2 err\)/);
  assert.match(text, /L4 readFile ✗ ENOENT.*×2 \(iterations 2, 5\)/);
});

test("compile error is reported without running", () => {
  const c = compileBranch(`async (tools) => {\n  import("fs");\n}`);
  assert.ok("error" in c && c.line === 2);
});

test("a trailing line comment after the program compiles", async () => {
  const { result } = await run(`async (tools) => {\n  return 1;\n} // done`);
  assert.ok(result.ok && result.value === 1);
});
