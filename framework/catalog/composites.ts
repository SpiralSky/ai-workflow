import type { ToolEntry } from "./types.js";

export const composites: ToolEntry[] = [
  {
    id: "findWithCallers",
    name: "findWithCallers",
    toolDef: {
      name: "findWithCallers",
      description: "Read a function's source and find all call sites across the workspace.",
      inputSchema: {
        type: "object",
        properties: {
          filePath: { type: "string", description: "File containing the function" },
          symbolName: { type: "string", description: "Function or method name" },
        },
        required: ["filePath", "symbolName"],
      },
    },
    searchDescription:
      "Find where a function is called from, identify all callers, assess refactor impact, " +
      "read a function's implementation and its usage sites together.",
    useCaseSummary:
      "Use findWithCallers before renaming, refactoring, or changing the signature of a function. " +
      "It reads the function's implementation and finds every place it is called across the workspace, " +
      "so you can assess the impact of a change and update all call sites. " +
      "Also useful for understanding how a function is used in practice before modifying its behaviour.",
    tags: ["callers", "refactor", "impact", "usage", "rename", "function", "search"],
    executionKind: "composite",
    composite: {
      declaration: "declare function findWithCallers(filePath: string, symbolName: string): Promise<{ source: string; callers: string[] }>;",
      implementation: "async function findWithCallers(filePath, symbolName) {\n  const [srcResult, grepResult] = await parallel(\n    readSymbol(filePath, symbolName).catch(() => readFile(filePath)),\n    bash(`grep -rn \"\\\\b${symbolName}\\\\b\" . --include=\"*.ts\" --include=\"*.js\" --include=\"*.mjs\" --include=\"*.py\" 2>/dev/null | grep -v \"^Binary\" | head -40`)\n  );\n  return {\n    source: srcResult,\n    callers: grepResult.out.split(\"\\n\").filter(Boolean),\n  };\n}",
      dependencies: ["readSymbol"],
    },
  },

  {
    id: "applyAndTest",
    name: "applyAndTest",
    toolDef: {
      name: "applyAndTest",
      description: "Apply an exact-string edit to a file and immediately run the test suite.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File to edit" },
          oldStr: { type: "string", description: "Exact string to replace (must appear exactly once)" },
          newStr: { type: "string", description: "Replacement string" },
          filter: { type: "string", description: "Optional test filter (Python only)" },
        },
        required: ["path", "oldStr", "newStr"],
      },
    },
    searchDescription:
      "Fix a bug and verify with tests, make a code change and check it works, " +
      "apply a patch and run the test suite.",
    useCaseSummary:
      "Use applyAndTest to apply a single code fix and immediately verify it with the test suite. " +
      "It combines edit() and runTests() in one atomic step, returning whether tests passed " +
      "and any failure output. Ideal for bug fixes where the correct change is known.",
    tags: ["edit", "test", "fix", "verify", "patch", "apply"],
    executionKind: "composite",
    composite: {
      declaration: "declare function applyAndTest(path: string, oldStr: string, newStr: string, filter?: string): Promise<{ ok: boolean; failures: string }>;",
      implementation: "async function applyAndTest(path, oldStr, newStr, filter) {\n  await edit(path, oldStr, newStr);\n  return runTests(filter);\n}",
      dependencies: ["runTests"],
    },
  },

  {
    id: "findAndReplace",
    name: "findAndReplace",
    toolDef: {
      name: "findAndReplace",
      description: "Find all occurrences of a literal string across workspace files and replace each one.",
      inputSchema: {
        type: "object",
        properties: {
          pattern: { type: "string", description: "Literal string to find" },
          replacement: { type: "string", description: "Replacement string" },
          fileGlob: { type: "string", description: "File pattern to search (default: common source files)" },
        },
        required: ["pattern", "replacement"],
      },
    },
    searchDescription:
      "Rename something across files, replace all occurrences of a string, global search and replace.",
    useCaseSummary:
      "Use findAndReplace when you need to rename a symbol, string, or identifier across multiple files. " +
      "It finds every occurrence and applies the replacement to each file. " +
      "Use it for renames, updating a constant's value everywhere, or migrating an old API name. " +
      "For single-file replacements, use edit directly.",
    tags: ["rename", "replace", "global", "all", "occurrences", "refactor", "string"],
    executionKind: "composite",
    composite: {
      declaration: "declare function findAndReplace(pattern: string, replacement: string, fileGlob?: string): Promise<{ changed: string[]; skipped: string[] }>;",
      implementation: "async function findAndReplace(pattern, replacement, fileGlob) {\n  const glob = fileGlob ?? \"*.{ts,js,mjs,py,json,md}\";\n  const escaped = pattern.replace(/[\"\\\\]/g, (c) => \"\\\\\" + c);\n  const grepResult = await bash(`grep -rl --include=\"${glob}\" \"${escaped}\" . 2>/dev/null`);\n  const files = grepResult.out.split(\"\\n\").filter(Boolean);\n  const changed = [], skipped = [];\n  for (const file of files) {\n    try {\n      const content = await readFile(file);\n      if (!content.includes(pattern)) { skipped.push(file); continue; }\n      const newContent = content.split(pattern).join(replacement);\n      await bash(`cp \"${file}\" \"${file}.bak\" && cat > \"${file}\" << 'ENDF'\\n${newContent}\\nENDF`);\n      changed.push(file);\n    } catch (e) {\n      skipped.push(file + \": \" + String(e).slice(0, 80));\n    }\n  }\n  return { changed, skipped };\n}",
    },
  },

  {
    id: "readAndSummarize",
    name: "readAndSummarize",
    toolDef: {
      name: "readAndSummarize",
      description: "Read a file and produce a concise summary of its contents.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "File to read and summarize" },
          focus: { type: "string", description: "Optional aspect to focus on" },
        },
        required: ["path"],
      },
    },
    searchDescription:
      "Understand a large file quickly, get an overview of what a module does, " +
      "orient to unfamiliar code, extract key information.",
    useCaseSummary:
      "Use readAndSummarize when you need to quickly understand a large or unfamiliar file " +
      "without reading it in full. It reads the file and uses a cheap LLM to produce a concise summary, " +
      "optionally focused on a specific aspect like exports, data flow, or configuration options.",
    tags: ["summarize", "understand", "overview", "orient", "explain", "large", "file"],
    executionKind: "composite",
    composite: {
      declaration: "declare function readAndSummarize(path: string, focus?: string): Promise<string>;",
      implementation: "async function readAndSummarize(path, focus) {\n  const content = await readFile(path);\n  const focusClause = focus ? ` Focus on: ${focus}.` : \"\";\n  return weakLLM(\n    `Summarize this file concisely (3-6 sentences).${focusClause}\\n\\nFile: ${path}\\n\\n${content.slice(0, 8000)}`\n  );\n}",
      dependencies: ["weakLLM"],
    },
  },

  {
    id: "patchAndVerify",
    name: "patchAndVerify",
    toolDef: {
      name: "patchAndVerify",
      description: "Create a new file, run an optional verification command, then run the test suite.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Path for the new file" },
          content: { type: "string", description: "File content" },
          verifyCmd: { type: "string", description: "Shell command to verify the file (e.g. tsc --noEmit)" },
        },
        required: ["path", "content"],
      },
    },
    searchDescription:
      "Create a new file and verify it compiles or lints correctly, add a new module and run tests.",
    useCaseSummary:
      "Use patchAndVerify when adding a new file that needs to be validated before running tests. " +
      "It creates the file, optionally runs a verification command to catch syntax errors, " +
      "and then runs the full test suite.",
    tags: ["create", "verify", "lint", "compile", "new", "file", "test"],
    executionKind: "composite",
    composite: {
      declaration: "declare function patchAndVerify(path: string, content: string, verifyCmd?: string): Promise<{ verifyOk: boolean; testResult: { ok: boolean; failures: string } }>;",
      implementation: "async function patchAndVerify(path, content, verifyCmd) {\n  await writeFile(path, content);\n  let verifyOk = true;\n  if (verifyCmd) {\n    const r = await bash(verifyCmd);\n    verifyOk = r.code === 0;\n    if (!verifyOk) return { verifyOk, testResult: { ok: false, failures: r.out.slice(-1000) } };\n  }\n  const testResult = await runTests();\n  return { verifyOk, testResult };\n}",
      dependencies: ["writeFile", "runTests"],
    },
  },
];
