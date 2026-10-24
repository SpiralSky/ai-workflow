import { needSidecar, type Sidecar } from "../../sidecar.ts";
import { objectSchema, type ToolDef } from "../../types.ts";

/** `runSnippet`: runs a short Python snippet in a child process with the workspace importable. */
export function makeRunSnippet(sc?: Sidecar): ToolDef {
  return {
    name: "runSnippet",
    description: "Run a short Python snippet in a fresh process (cwd = workspace, workspace modules importable). Returns stdout, stderr, the repr of the last expression, or the exception with its traceback.",
    parameters: objectSchema({
      code: { type: "string", description: "Python source; a last expression is returned as value (repr)." },
      timeoutMs: { type: "integer", description: "Kill the process after this many ms (default 30000, max 300000)." },
    }, ["code"]),
    returns: "{ stdout: string; stderr: string; value?: string; exception?: { type: string; message: string; traceback: string }; timedOut?: true; exitCode?: number | null }",
    meta: {
      whenToUse: "Reproduce a bug or check what a function returns without writing a file.",
      whenNotToUse: "Not for running the test suite (use runTests) or shell commands (use bash).",
      examples: ["from app.store import Store; Store().count()", "import json; print(json.dumps(load('data.json')))"],
      category: "test",
      effect: "exec",
      requires: [],
      cost: 3,
    },
    async fn(args: { code: string; timeoutMs?: number }, ctx) {
      return needSidecar(sc).call("runSnippet", { code: args.code, timeoutMs: args.timeoutMs }, ctx.signal);
    },
  };
}
