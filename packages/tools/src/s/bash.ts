import { spawn } from "node:child_process";
import { toolEnv } from "../env.ts";
import { objectSchema, type ToolDef } from "../types.ts";

/** Default timeout in ms. */
export const DEFAULT_TIMEOUT_MS = 60_000;
/** Exit code reported when the command was killed for exceeding its timeout (as `timeout(1)`). */
export const TIMEOUT_CODE = 124;
/** Exit code reported when the call was aborted (128 + SIGINT). */
export const ABORT_CODE = 130;
/** Bytes of output kept from the start. */
const HEAD_BYTES = 2000;
/** Bytes of output kept from the end (errors are usually last). */
const TAIL_BYTES = 4000;

/** Keeps the head and tail of `text` within `HEAD_BYTES` + `TAIL_BYTES`, marking the cut bytes in the middle. UTF-8 safe; cuts at a line boundary when one is near. */
function clip(text: string): string {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= HEAD_BYTES + TAIL_BYTES) return text;
  let headEnd = HEAD_BYTES;
  while (headEnd > 0 && (buf[headEnd]! & 0xc0) === 0x80) headEnd--;
  const nl = buf.lastIndexOf(10, headEnd - 1);
  if (nl >= HEAD_BYTES / 2) headEnd = nl + 1;
  let tailStart = buf.length - TAIL_BYTES;
  while (tailStart < buf.length && (buf[tailStart]! & 0xc0) === 0x80) tailStart++;
  const nl2 = buf.indexOf(10, tailStart);
  if (nl2 >= 0 && nl2 - tailStart < TAIL_BYTES / 2) tailStart = nl2 + 1;
  const head = buf.subarray(0, headEnd).toString("utf8");
  const tail = buf.subarray(tailStart).toString("utf8");
  return `${head}\n[${tailStart - headEnd} bytes cut]\n${tail}`;
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
        if (ending === "timeout") return resolve({ code: TIMEOUT_CODE, out: clip(out) + `\n[timed out after ${timeoutMs} ms; process group killed]` });
        if (ending === "abort") return resolve({ code: ABORT_CODE, out: clip(out) + "\n[aborted]" });
        resolve({ code: code ?? 1, out: clip(out) });
      });
    });
  },
};
