import { spawn } from "node:child_process";
import { toolEnv } from "../env.ts";
import { objectSchema, type ToolDef } from "../types.ts";

/** Default timeout in ms. */
export const DEFAULT_TIMEOUT_MS = 60_000;
/** Exit code reported when the command was killed for exceeding its timeout (as `timeout(1)`). */
export const TIMEOUT_CODE = 124;
/** Exit code reported when the call was aborted (128 + SIGINT). */
export const ABORT_CODE = 130;
/** Bytes of output kept (the tail; errors are usually last). */
const KEEP_BYTES = 6000;

/** Keeps the tail of `text` within `KEEP_BYTES`, noting the omission. */
function tail(text: string): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= KEEP_BYTES) return text;
  let start = buf.length - KEEP_BYTES;
  while (start < buf.length && (buf[start]! & 0xc0) === 0x80) start++;
  return `[output truncated: showing last ${buf.length - start} of ${buf.length} bytes; redirect to a file and use readFile/grep for the rest]\n${buf.subarray(start).toString("utf8")}`;
}

/**
 * `bash`: runs `cmd` with `bash -lc` in the workspace root, stdout and stderr interleaved. The whole
 * process group is killed on timeout (code 124, `out` ends with a timed-out note) or abort (code 130).
 */
export const bash: ToolDef = {
  name: "bash",
  description: "Run a shell command in the workspace; returns { code, out } with stdout and stderr combined. For scripts and anything no other tool covers.",
  parameters: objectSchema(
    {
      cmd: { type: "string", description: "Shell command line." },
      timeoutMs: { type: "integer", description: "Kill after this many ms (default 60000)." },
    },
    ["cmd"],
  ),
  returns: "{ code: number; out: string }",
  meta: {
    whenToUse: "Run a script or command, install or build something, or do anything no dedicated tool covers.",
    whenNotToUse: "Not for reading, writing, editing or searching files, nor for running tests when a dedicated test tool exists; use that tool.",
    examples: ["run the build script", "run a python snippet", "list running processes"],
    category: "shell",
    effect: "write",
    requires: [],
    cost: 3,
  },
  async fn(args: { cmd: string; timeoutMs?: number }, ctx) {
    const timeoutMs = args.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    return await new Promise((resolve, reject) => {
      if (ctx.signal.aborted) return resolve({ code: ABORT_CODE, out: "[aborted]" });
      const child = spawn("bash", ["-lc", args.cmd], {
        cwd: ctx.root,
        env: toolEnv(ctx.env ?? process.env),
        detached: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let out = "";
      let ending: "timeout" | "abort" | null = null;
      const killGroup = () => {
        try { process.kill(-child.pid!, "SIGKILL"); } catch { /* already gone */ }
      };
      const timer = setTimeout(() => { ending = "timeout"; killGroup(); }, timeoutMs);
      const onAbort = () => { ending = "abort"; killGroup(); };
      ctx.signal.addEventListener("abort", onAbort, { once: true });
      const onData = (d: Buffer) => { out += d.toString("utf8"); if (out.length > 4_000_000) out = out.slice(-2_000_000); };
      child.stdout.on("data", onData);
      child.stderr.on("data", onData);
      child.on("error", (e) => { clearTimeout(timer); reject(e); });
      child.on("close", (code) => {
        clearTimeout(timer);
        ctx.signal.removeEventListener("abort", onAbort);
        killGroup(); // reap stragglers that outlived the shell
        if (ending === "timeout") return resolve({ code: TIMEOUT_CODE, out: tail(out) + `\n[timed out after ${timeoutMs} ms; process group killed]` });
        if (ending === "abort") return resolve({ code: ABORT_CODE, out: tail(out) + "\n[aborted]" });
        resolve({ code: code ?? 1, out: tail(out) });
      });
    });
  },
};
