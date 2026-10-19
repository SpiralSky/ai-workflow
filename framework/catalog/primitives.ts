import type { ToolEntry } from "./types.js";

export const primitives: ToolEntry[] = [
  {
    id: "bash",
    name: "bash",
    toolDef: {
      name: "bash",
      description: "Run a shell command and return its stdout/stderr output and exit code.",
      inputSchema: {
        type: "object",
        properties: {
          cmd: { type: "string", description: "Shell command to execute" },
          opts: {
            type: "object",
            description: "Options",
            properties: { timeoutMs: { type: "number", description: "Timeout in ms; kills process group on expiry" } },
          },
        },
        required: ["cmd"],
      },
    },
    searchDescription:
      "Execute a shell command, run scripts, call CLIs, grep files, compile code, " +
      "check file existence, count lines, run linters, pipe commands together.",
    useCaseSummary:
      "Use bash when you need to run any shell command or system operation: searching files with grep or find, " +
      "running compilers or linters, checking git status, counting occurrences in files, " +
      "executing build scripts, piping data between tools, or invoking any CLI. " +
      "It returns the command output and exit code so you can branch on success or failure. " +
      "Prefer it for exact-text searches, file-system operations, and any task where a single shell invocation suffices.",
    tags: ["shell", "command", "grep", "find", "run", "execute", "cli", "script", "lint", "compile"],
    executionKind: "helper",
    tsDeclaration:
      "declare function bash(cmd: string, opts?: { timeoutMs?: number }): Promise<{ code: number; out: string }>;",
  },

  {
    id: "readFile",
    name: "readFile",
    toolDef: {
      name: "readFile",
      description: "Read the full contents of a file and return it as a string.",
      inputSchema: {
        type: "object",
        properties: { path: { type: "string", description: "Workspace-relative file path" } },
        required: ["path"],
      },
    },
    searchDescription:
      "Read a file's contents, load source code, inspect configuration files, " +
      "read documentation, examine test files.",
    useCaseSummary:
      "Use readFile when you need to read the complete contents of a file: inspecting source code before editing, " +
      "reading configuration files, loading test files to understand expected behaviour, " +
      "checking documentation, or verifying a file's current state. " +
      "Prefer readSymbol when you only need one function or class to avoid loading a large file. " +
      "Use readFile for small files, config files, or when you need to see the full context.",
    tags: ["file", "read", "contents", "source", "config", "inspect"],
    executionKind: "helper",
    tsDeclaration: "declare function readFile(path: string): Promise<string>;",
  },

  {
    id: "readSymbol",
    name: "readSymbol",
    toolDef: {
      name: "readSymbol",
      description: "Extract the source of a single named function, class, or type from a file.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path" },
          name: { type: "string", description: "Symbol name (function, class, const, type, etc.)" },
        },
        required: ["path", "name"],
      },
    },
    searchDescription:
      "Read the source of a specific function, class, type, or method without loading the full file. " +
      "Inspect implementation details, understand a function's logic, read a class definition.",
    useCaseSummary:
      "Use readSymbol when you need to inspect a specific function, class, type, or constant in a file. " +
      "It extracts just that symbol's source without loading the whole file, saving context. " +
      "Ideal for understanding a function's current implementation before editing it, " +
      "inspecting a class's methods, verifying a type definition, or reading a helper before calling it. " +
      "Use it before editing a function to capture the exact old string for the edit call.",
    tags: ["function", "class", "symbol", "source", "read", "inspect", "definition", "implementation"],
    executionKind: "helper",
    tsDeclaration: "declare function readSymbol(path: string, name: string): Promise<string>;",
  },

  {
    id: "findFiles",
    name: "findFiles",
    toolDef: {
      name: "findFiles",
      description: "Find files matching a glob pattern in the workspace.",
      inputSchema: {
        type: "object",
        properties: { glob: { type: "string", description: "Glob pattern, e.g. 'src/**/*.ts'" } },
        required: ["glob"],
      },
    },
    searchDescription:
      "Search for files by name pattern, extension, or directory. List files of a type, " +
      "find test files, locate configuration files, discover source files.",
    useCaseSummary:
      "Use findFiles when you need to locate files by pattern: finding all TypeScript files in a directory, " +
      "locating test files, discovering configuration files, or checking which files match a naming convention. " +
      "Returns a list of matching file paths. Combine with readFile or readSymbol to then inspect the found files. " +
      "Use bash with grep when you need to find files containing specific text rather than just matching by name.",
    tags: ["file", "search", "glob", "find", "list", "discover", "pattern"],
    executionKind: "helper",
    tsDeclaration: "declare function findFiles(glob: string): Promise<string[]>;",
  },

  {
    id: "edit",
    name: "edit",
    toolDef: {
      name: "edit",
      description:
        "Replace an exact string in a file. The old string must appear exactly once.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path" },
          oldStr: { type: "string", description: "Exact string to replace (must appear exactly once)" },
          newStr: { type: "string", description: "Replacement string" },
        },
        required: ["path", "oldStr", "newStr"],
      },
    },
    searchDescription:
      "Modify a file by replacing an exact string, fix a bug, change a function implementation, " +
      "update configuration, rename a variable, apply a patch.",
    useCaseSummary:
      "Use edit to make a targeted change to an existing file by replacing an exact string with new content. " +
      "Ideal for bug fixes, updating function implementations, changing config values, renaming identifiers, " +
      "or applying any modification where you know the exact current text. " +
      "Always read the current content with readFile or readSymbol first to capture the exact old string. " +
      "The old string must appear exactly once in the file; include enough surrounding context to ensure uniqueness.",
    tags: ["edit", "modify", "fix", "patch", "change", "replace", "update", "file"],
    executionKind: "helper",
    tsDeclaration:
      "declare function edit(path: string, oldStr: string, newStr: string): Promise<void>;",
  },

  {
    id: "writeFile",
    name: "writeFile",
    toolDef: {
      name: "writeFile",
      description: "Create a new file with the given content. Only for new files; use edit for existing ones.",
      inputSchema: {
        type: "object",
        properties: {
          path: { type: "string", description: "Workspace-relative file path (must not already exist)" },
          content: { type: "string", description: "File content" },
        },
        required: ["path", "content"],
      },
    },
    searchDescription:
      "Create a new file, write a new module, add a test file, generate a configuration file.",
    useCaseSummary:
      "Use writeFile to create a new file in the workspace. Suitable for adding new source files, " +
      "creating test files, writing configuration files, or generating scaffolding. " +
      "It only works for files that do not yet exist; use edit to modify an existing file. " +
      "Combine with runTests to verify the new file integrates correctly.",
    tags: ["create", "write", "new", "file", "generate", "scaffold"],
    executionKind: "helper",
    tsDeclaration: "declare function writeFile(path: string, content: string): Promise<void>;",
  },

  {
    id: "runTests",
    name: "runTests",
    toolDef: {
      name: "runTests",
      description: "Run the project test suite and return pass/fail with failure output.",
      inputSchema: {
        type: "object",
        properties: {
          filter: {
            type: "string",
            description: "Optional test name filter (Python -k style; ignored for npm)",
          },
        },
        required: [],
      },
    },
    searchDescription:
      "Run tests, verify a change did not break anything, check test results, " +
      "confirm a fix works, run the test suite.",
    useCaseSummary:
      "Use runTests after making changes to verify correctness. It runs the project's test suite " +
      "and returns whether tests passed, along with failure details if they did not. " +
      "Use it after edit or writeFile to confirm the change works. " +
      "An optional filter narrows to specific test names (Python only). " +
      "Combine with edit in a single branch: edit the code, run tests, return pass/fail.",
    tags: ["test", "verify", "check", "pass", "fail", "suite", "run"],
    executionKind: "helper",
    tsDeclaration:
      "declare function runTests(filter?: string): Promise<{ ok: boolean; failures: string }>;",
  },

  {
    id: "check",
    name: "check",
    toolDef: {
      name: "check",
      description:
        "Ask a cheap model a boolean question about a text passage. Returns true or false.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "The text to reason about (truncated to 12k chars)" },
          question: { type: "string", description: "A yes/no question about the text" },
        },
        required: ["text", "question"],
      },
    },
    searchDescription:
      "Make a boolean judgment about text content, determine if code has a certain property, " +
      "check whether a description matches, verify a condition in prose.",
    useCaseSummary:
      "Use check when you need a fuzzy boolean judgment that cannot be determined by an exact string match or exit code. " +
      "For example: 'Does this function validate its input?', 'Is this error message about a timeout?', " +
      "'Does this implementation follow the described behaviour?'. " +
      "It uses a cheap fast model. Prefer exit codes and grep for deterministic checks; " +
      "use check only when the question requires natural-language reasoning.",
    tags: ["llm", "judgment", "boolean", "question", "reason", "fuzzy", "classify"],
    executionKind: "helper",
    tsDeclaration:
      "declare function check(text: string, question: string): Promise<boolean>;",
  },

  {
    id: "classify",
    name: "classify",
    toolDef: {
      name: "classify",
      description:
        "Ask a cheap model to classify text into one of several labeled categories.",
      inputSchema: {
        type: "object",
        properties: {
          text: { type: "string", description: "Text to classify (truncated to 12k chars)" },
          labels: {
            type: "object",
            description: "Map of label to description, e.g. { bugFix: 'A bug fix', feature: 'New functionality' }",
            properties: {},
          },
        },
        required: ["text", "labels"],
      },
    },
    searchDescription:
      "Categorize text, identify the type of change, determine intent, label an error.",
    useCaseSummary:
      "Use classify when you need to categorize text into one of several named options using language understanding. " +
      "Useful for identifying the kind of error, categorizing a function's purpose, " +
      "determining whether a change is a bug fix or feature, or routing a task to a specific handler. " +
      "Provide clear label descriptions so the model can make an accurate choice. " +
      "Like check, prefer deterministic methods when possible.",
    tags: ["llm", "categorize", "label", "classify", "type", "category", "route"],
    executionKind: "helper",
    tsDeclaration:
      "declare function classify<L extends string>(text: string, labels: Record<L, string>): Promise<L>;",
  },

  {
    id: "weakLLM",
    name: "weakLLM",
    toolDef: {
      name: "weakLLM",
      description:
        "Call a fast cheap model (haiku) with a prompt and optional context. Returns the model response.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The prompt text" },
          opts: {
            type: "object",
            description: "Options",
            properties: { ctx: { type: "array", description: "Additional context items" } },
          },
        },
        required: ["prompt"],
      },
    },
    searchDescription:
      "Summarize text, generate a short description, extract key information, " +
      "produce a brief explanation, rewrite prose, answer a factual question cheaply.",
    useCaseSummary:
      "Use weakLLM for tasks that need language generation but not deep reasoning: summarizing a long file, " +
      "generating a short description, extracting structured information from prose, " +
      "reformatting text, translating between formats, or producing a one-paragraph explanation. " +
      "It uses a fast cheap model; use llm for tasks requiring better reasoning or more careful output.",
    tags: ["llm", "summarize", "generate", "extract", "explain", "rewrite", "cheap", "fast"],
    executionKind: "helper",
    tsDeclaration:
      "declare function weakLLM(prompt: string, opts?: { ctx?: unknown[] }): Promise<string>;",
  },

  {
    id: "llm",
    name: "llm",
    toolDef: {
      name: "llm",
      description:
        "Call a capable model (sonnet) with a prompt and optional context. Returns the model response.",
      inputSchema: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "The prompt text" },
          opts: {
            type: "object",
            description: "Options",
            properties: { ctx: { type: "array", description: "Additional context items" } },
          },
        },
        required: ["prompt"],
      },
    },
    searchDescription:
      "Analyze code, reason about complex problems, generate non-trivial implementations, " +
      "plan multi-step solutions, explain design decisions.",
    useCaseSummary:
      "Use llm for tasks requiring deeper reasoning or careful generation: analyzing the root cause of a bug, " +
      "generating a non-trivial code implementation, explaining a complex algorithm, " +
      "planning how to approach a refactor, or producing output that needs to be accurate and well-structured. " +
      "It uses a more capable but slower model. Use weakLLM for simple summarization or extraction.",
    tags: ["llm", "reason", "analyze", "generate", "plan", "complex", "strong"],
    executionKind: "helper",
    tsDeclaration:
      "declare function llm(prompt: string, opts?: { ctx?: unknown[] }): Promise<string>;",
  },

  {
    id: "tool",
    name: "tool",
    toolDef: {
      name: "tool",
      description:
        "Call any Claude Code built-in tool by name (Bash, Read, Write, Edit, Glob, Grep, WebFetch).",
      inputSchema: {
        type: "object",
        properties: {
          name: {
            type: "string",
            description: "Tool name: Bash, Read, Write, Edit, Glob, Grep, or WebFetch",
          },
          input: { type: "object", description: "Tool input matching the named tool's schema", properties: {} },
        },
        required: ["name", "input"],
      },
    },
    searchDescription:
      "Access Claude Code's built-in Read, Write, Edit, Bash, Glob, Grep, WebFetch tools " +
      "via the tool() dispatcher. Fetch web pages, read files, do glob searches.",
    useCaseSummary:
      "Use tool() to call Claude Code's native tools: Read a file, Write a file, Edit with old/new strings, " +
      "Bash a command, Glob for file patterns, Grep for text patterns, or WebFetch a URL. " +
      "Particularly useful for WebFetch (fetching web pages or documentation) since there is no direct " +
      "web-fetch helper. Also useful when you want to use the same interface as Claude Code's own tools.",
    tags: ["builtin", "claude", "read", "write", "grep", "glob", "web", "fetch", "dispatch"],
    executionKind: "builtin",
    tsDeclaration: [
      'declare function tool(name: "Bash", input: { command: string; timeout?: number }): Promise<string>;',
      'declare function tool(name: "Read", input: { file_path: string }): Promise<string>;',
      'declare function tool(name: "Write", input: { file_path: string; content: string }): Promise<string>;',
      'declare function tool(name: "Edit", input: { file_path: string; old_string: string; new_string: string }): Promise<string>;',
      'declare function tool(name: "Glob", input: { pattern: string }): Promise<string>;',
      'declare function tool(name: "Grep", input: { pattern: string; path?: string }): Promise<string>;',
      'declare function tool(name: "WebFetch", input: { url: string }): Promise<string>;',
      "declare function tool(name: string, input: Record<string, unknown>): Promise<string>;",
    ].join("\n"),
  },

  {
    id: "parallel",
    name: "parallel",
    toolDef: {
      name: "parallel",
      description: "Run multiple async operations concurrently and wait for all to complete.",
      inputSchema: {
        type: "object",
        properties: {
          operations: {
            type: "array",
            description: "Array of promises to run in parallel",
            items: {},
          },
        },
        required: ["operations"],
      },
    },
    searchDescription:
      "Run multiple operations at the same time, fetch files concurrently, speed up independent tasks.",
    useCaseSummary:
      "Use parallel when you have multiple independent operations that can run simultaneously. " +
      "For example, reading several files at once, running multiple searches in parallel, " +
      "or fetching data from multiple sources concurrently. " +
      "It returns a tuple of all results in the same order as the inputs. " +
      "Only use it for operations that do not depend on each other's results.",
    tags: ["parallel", "concurrent", "speed", "multiple", "simultaneous"],
    executionKind: "helper",
    tsDeclaration:
      "declare function parallel<T extends readonly unknown[]>(...ps: T): Promise<{ [K in keyof T]: Awaited<T[K]> }>;",
  },

  {
    id: "returnUser",
    name: "returnUser",
    toolDef: {
      name: "returnUser",
      description:
        "End the current turn and deliver a message to the caller. Never returns.",
      inputSchema: {
        type: "object",
        properties: {
          message: { type: "string", description: "The final message or report to deliver" },
        },
        required: ["message"],
      },
    },
    searchDescription:
      "Signal completion, deliver a final report, end the execution turn, return results to the caller.",
    useCaseSummary:
      "Use returnUser to signal that the task is complete and deliver the final result. " +
      "Call it with a concise report of what was done, what was found, or what changed. " +
      "It ends execution immediately; nothing after it runs. " +
      "Use it only when the task is truly finished or when an escalation condition from the policy is met.",
    tags: ["done", "complete", "report", "end", "finish", "return", "signal"],
    executionKind: "helper",
    tsDeclaration: "declare function returnUser(message: string): never;",
  },

  {
    id: "getHandle",
    name: "getHandle",
    toolDef: {
      name: "getHandle",
      description:
        "Retrieve the full text of a result that was truncated and stored as a handle ($hN).",
      inputSchema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Handle ID, e.g. '$h1'" },
        },
        required: ["id"],
      },
    },
    searchDescription:
      "Retrieve a large result that was truncated, get the full content of an oversized return value.",
    useCaseSummary:
      "Use getHandle to retrieve the full content of a result that exceeded the 4000-character limit " +
      "and was stored as a handle like $h1. Results that mention a handle ID must be expanded with " +
      "getHandle before their content can be used. Call it in a subsequent branch if the prior result was truncated.",
    tags: ["handle", "truncated", "retrieve", "large", "overflow"],
    executionKind: "helper",
    tsDeclaration: "declare function getHandle(id: string): string;",
  },

  {
    id: "state",
    name: "state",
    toolDef: {
      name: "state",
      description:
        "Persistent key-value store that survives across multiple branch calls in the same session.",
      inputSchema: {
        type: "object",
        properties: {},
        required: [],
      },
    },
    searchDescription:
      "Store data between branch calls, accumulate results across turns, persist intermediate state.",
    useCaseSummary:
      "Use state to persist data across multiple branch calls: store the result of one branch " +
      "and retrieve it in the next, accumulate a list of findings across turns, " +
      "or track which files have already been processed. " +
      "Values must be JSON-serializable. State is lost if the branch times out.",
    tags: ["state", "persist", "store", "accumulate", "memory", "across", "turns"],
    executionKind: "helper",
    tsDeclaration: "declare const state: Record<string, unknown>;",
  },
];
