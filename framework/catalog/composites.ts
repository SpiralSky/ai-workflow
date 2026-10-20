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
    capability: "read a function's source plus all its call sites in one call",
    frameHint: "Covers readSymbol + grep-for-callers. Use before any rename or signature change to assess impact.",
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
    capability: "apply a single edit and run the test suite atomically",
    frameHint: "Covers the edit → runTests sequence when the fix is a single exact-string replacement.",
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
    capability: "replace a literal string across all matching files",
    frameHint: "Covers the grep-for-files + per-file-edit loop for global renames or string migrations.",
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
    capability: "read a file and produce a concise LLM-generated summary",
    frameHint: "Use for large files where an overview suffices. Delegates summarization to a cheap LLM internally.",
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
    capability: "create a new file, optionally verify it compiles, then run tests",
    frameHint: "Covers writeFile + optional lint/compile check + runTests for adding validated new files.",
    executionKind: "composite",
    composite: {
      declaration: "declare function patchAndVerify(path: string, content: string, verifyCmd?: string): Promise<{ verifyOk: boolean; testResult: { ok: boolean; failures: string } }>;",
      implementation: "async function patchAndVerify(path, content, verifyCmd) {\n  await writeFile(path, content);\n  let verifyOk = true;\n  if (verifyCmd) {\n    const r = await bash(verifyCmd);\n    verifyOk = r.code === 0;\n    if (!verifyOk) return { verifyOk, testResult: { ok: false, failures: r.out.slice(-1000) } };\n  }\n  const testResult = await runTests();\n  return { verifyOk, testResult };\n}",
      dependencies: ["writeFile", "runTests"],
    },
  },

  {
    id: "findDefinition",
    name: "findDefinition",
    toolDef: {
      name: "findDefinition",
      description: "Find where a symbol (function, class, variable) is defined, returning file path and line number.",
      inputSchema: {
        type: "object",
        properties: {
          name: { type: "string", description: "Symbol name to find" },
          ext: { type: "string", description: "File extension filter e.g. '.py' or '.ts' (optional)" },
        },
        required: ["name"],
      },
    },
    searchDescription:
      "Find where a symbol, function, class, or variable is defined. Returns file path and line number.",
    useCaseSummary:
      "Use findDefinition when you need to locate where a function, class, method, or variable is defined " +
      "in the codebase. Saves grep turns spent finding the right file and line. " +
      "Works across Python, TypeScript, JavaScript, and most text-based languages. " +
      "Use before editing a symbol when you don't know which file it lives in.",
    tags: ["find", "definition", "symbol", "location", "class", "function", "where", "defined"],
    capability: "find where any symbol is defined across the workspace",
    frameHint: "Use before editing a symbol when you don't know which file it's in. Saves manual grep turns.",
    executionKind: "composite",
    composite: {
      declaration: "declare function findDefinition(name: string, ext?: string): Promise<string>;",
      implementation: "async function findDefinition(name, ext) {\n  const filter = ext\n    ? `--include=\"*${ext}\"`\n    : '--include=\"*.py\" --include=\"*.ts\" --include=\"*.js\" --include=\"*.tsx\"';\n  const r = await bash(`grep -rn \"def ${name}\\\\b\\\\|class ${name}\\\\b\\\\|function ${name}\\\\b\\\\|const ${name} =\\\\|${name} =\" . ${filter} 2>/dev/null | grep -v node_modules | grep -v __pycache__ | head -20`);\n  return r.out.trim() || `No definition found for '${name}'`;\n}",
      dependencies: ["bash"],
    },
  },

  {
    id: "renameSymbol",
    name: "renameSymbol",
    toolDef: {
      name: "renameSymbol",
      description: "Atomically rename a symbol across all workspace files using word-boundary replacement.",
      inputSchema: {
        type: "object",
        properties: {
          oldName: { type: "string", description: "Current symbol name" },
          newName: { type: "string", description: "New symbol name" },
          ext: { type: "string", description: "File extension filter e.g. '.py' (optional, defaults to .py/.ts/.js)" },
        },
        required: ["oldName", "newName"],
      },
    },
    searchDescription:
      "Rename a symbol, function, class, or variable across all files. Atomic rename, word-boundary safe.",
    useCaseSummary:
      "Use renameSymbol to rename a function, class, variable, or identifier across the entire workspace. " +
      "It finds every file containing the old name and replaces all word-boundary occurrences atomically. " +
      "Use for renames, refactors, or when an identifier is used in many files. " +
      "Safer than manual grep + edit because it handles all files in one step.",
    tags: ["rename", "refactor", "symbol", "atomic", "replace", "all", "occurrences"],
    capability: "atomically rename a symbol across all workspace files",
    frameHint: "Covers grep-find + multi-edit for a rename. Use for renaming functions, classes, or variables.",
    executionKind: "composite",
    composite: {
      declaration: "declare function renameSymbol(oldName: string, newName: string, ext?: string): Promise<string>;",
      implementation: "async function renameSymbol(oldName, newName, ext) {\n  const filter = ext\n    ? `--include=\"*${ext}\"`\n    : '--include=\"*.py\" --include=\"*.ts\" --include=\"*.js\"';\n  const found = await bash(`grep -rl \"\\\\b${oldName}\\\\b\" . ${filter} 2>/dev/null | grep -v node_modules | grep -v __pycache__`);\n  const files = found.out.trim().split('\\n').filter(Boolean);\n  if (!files.length) return `No files found containing '${oldName}'`;\n  const args = files.map(f => `\"${f}\"`).join(' ');\n  const r = await bash(`sed -i 's/\\\\b${oldName}\\\\b/${newName}/g' ${args}`);\n  return r.code === 0\n    ? `Renamed '${oldName}' → '${newName}' in ${files.length} file(s): ${files.join(', ')}`\n    : `sed failed: ${r.out}`;\n}",
      dependencies: ["bash"],
    },
  },

  {
    id: "pyInspect",
    name: "pyInspect",
    toolDef: {
      name: "pyInspect",
      description: "List all classes and top-level functions in a Python file with their line numbers.",
      inputSchema: {
        type: "object",
        properties: {
          file: { type: "string", description: "Workspace-relative path to the Python file" },
        },
        required: ["file"],
      },
    },
    searchDescription:
      "List Python classes and functions, get a structural outline of a Python file, " +
      "inspect what methods a class has, understand a Python module's structure.",
    useCaseSummary:
      "Use pyInspect to get a quick structural outline of a Python file: all class names, " +
      "top-level function names, and method names with their line numbers. " +
      "Use instead of readFile when you only need to know what symbols are in a file, " +
      "not their full implementation. Faster than reading the whole file for large modules.",
    tags: ["python", "inspect", "classes", "functions", "structure", "list", "methods", "outline"],
    capability: "list all classes and functions in a Python file with line numbers",
    frameHint: "Python-specific outline. Use instead of readFile when you only need to know what symbols exist in a file.",
    executionKind: "composite",
    composite: {
      declaration: "declare function pyInspect(file: string): Promise<string>;",
      implementation: "async function pyInspect(file) {\n  const r = await bash(`grep -n \"^class \\\\|^def \\\\|^    def \" \"${file}\" | head -40`);\n  return r.out.trim() || 'No classes or functions found';\n}",
      dependencies: ["bash"],
    },
  },

  {
    id: "runTestsForFile",
    name: "runTestsForFile",
    toolDef: {
      name: "runTestsForFile",
      description: "Run only the tests associated with a specific file or module by name.",
      inputSchema: {
        type: "object",
        properties: {
          file: { type: "string", description: "File path or module name to run tests for" },
        },
        required: ["file"],
      },
    },
    searchDescription:
      "Run tests for a specific file, run targeted tests after editing one module, " +
      "check only the tests related to a changed file.",
    useCaseSummary:
      "Use runTestsForFile after editing a single file when you want to run only that file's tests " +
      "rather than the full suite. Faster feedback for large test suites. " +
      "Extracts the module name from the file path and uses it as a test filter.",
    tags: ["tests", "file", "targeted", "run", "specific", "module", "coverage"],
    capability: "run only the tests for a specific file or module",
    frameHint: "Faster than runTests() for large suites. Use after editing a single file to run just its tests.",
    executionKind: "composite",
    composite: {
      declaration: "declare function runTestsForFile(file: string): Promise<{ ok: boolean; failures: string }>;",
      implementation: "async function runTestsForFile(file) {\n  const module = file.replace(/^.*\\//, '').replace(/\\.py$/, '');\n  return runTests(module);\n}",
      dependencies: ["runTests"],
    },
  },

  {
    id: "listImports",
    name: "listImports",
    toolDef: {
      name: "listImports",
      description: "Show what a file imports and which other files import it.",
      inputSchema: {
        type: "object",
        properties: {
          file: { type: "string", description: "Workspace-relative path to the file" },
        },
        required: ["file"],
      },
    },
    searchDescription:
      "Show file dependencies, find what imports a module, detect circular dependencies, " +
      "understand a file's dependency footprint before moving or deleting it.",
    useCaseSummary:
      "Use listImports to understand a file's dependency footprint: what it imports itself, " +
      "and which other files import it. Useful before moving, deleting, or refactoring a module " +
      "to understand the blast radius. Works for Python, TypeScript, and JavaScript files.",
    tags: ["imports", "dependencies", "module", "dependency", "circular", "python", "typescript"],
    capability: "show what a file imports and what other files import it",
    frameHint: "Use before moving or deleting a file to understand its dependency footprint.",
    executionKind: "composite",
    composite: {
      declaration: "declare function listImports(file: string): Promise<string>;",
      implementation: "async function listImports(file) {\n  const base = file.replace(/^.*\\//, '').replace(/\\.[a-z]+$/, '');\n  const [ownImports, incomingImports] = await parallel(\n    bash(`grep -n \"^import \\\\|^from \" \"${file}\" 2>/dev/null`),\n    bash(`grep -rn \"import ${base}\\\\|from.*${base}\" . --include=\"*.py\" --include=\"*.ts\" --include=\"*.js\" 2>/dev/null | grep -v \"^${file}\" | grep -v node_modules | grep -v __pycache__ | head -15`)\n  );\n  return `=== Imports in ${file}:\\n${ownImports.out.trim() || 'none'}\\n\\n=== Imported by:\\n${incomingImports.out.trim() || 'none'}`;\n}",
      dependencies: ["bash"],
    },
  },
];
