import { spawn, type ChildProcess } from "node:child_process";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { toolEnv } from "./env.ts";

/** Directory holding the `aiw_sidecar` package (put on PYTHONPATH). */
const PYTHON_DIR = fileURLToPath(new URL("../python", import.meta.url));

/** Options of `Sidecar`. */
export interface SidecarOpts {
  /** Absolute workspace root: the sidecar's cwd and the base of its relative paths. */
  root: string;
  /** Environment source (default `process.env`); secrets are stripped by `toolEnv`. `AIW_VENV` picks the venv. */
  env?: NodeJS.ProcessEnv;
}

interface Pending { proc: ChildProcess; resolve(v: unknown): void; reject(e: Error): void }

/**
 * Client of the Python analysis sidecar (tool-catalog §4): one long-lived `python -m aiw_sidecar`
 * speaking newline-delimited JSON-RPC over stdio. Starts lazily on the first call, serves concurrent
 * calls by id, and restarts on the next call after a crash.
 */
export class Sidecar {
  private proc: ChildProcess | undefined;
  private pending = new Map<number, Pending>();
  private nextId = 1;
  private readonly opts: SidecarOpts;

  constructor(opts: SidecarOpts) {
    this.opts = opts;
  }

  /** Process id of the running sidecar (for tests); undefined when not started. */
  get pid(): number | undefined {
    return this.proc?.pid;
  }

  /** Starts the process if it is not running. */
  private start(): ChildProcess {
    if (this.proc) return this.proc;
    const base = this.opts.env ?? process.env;
    const venv = base.AIW_VENV || "/opt/aiw/venv";
    const env = { ...toolEnv(base), PYTHONPATH: PYTHON_DIR, PYTHONUNBUFFERED: "1", PYTHONDONTWRITEBYTECODE: "1" };
    const proc = spawn(`${venv}/bin/python`, ["-m", "aiw_sidecar", this.opts.root], { cwd: this.opts.root, env, stdio: ["pipe", "pipe", "pipe"] });
    this.proc = proc;
    let stderr = "";
    proc.stderr!.on("data", (d) => (stderr = (stderr + d).slice(-500)));
    createInterface({ input: proc.stdout! }).on("line", (line) => this.onLine(line));
    proc.stdin!.on("error", () => {});
    const die = (why: string) => {
      if (this.proc === proc) this.proc = undefined;
      this.failPending(proc, why);
    };
    proc.on("error", (e) => die(`sidecar failed to start: ${e.message}`));
    proc.on("close", () => die(`sidecar crashed${stderr.trim() ? `: ${stderr.trim().split("\n").pop()}` : ""}`));
    return proc;
  }

  /** Rejects the calls in flight on `proc`. */
  private failPending(proc: ChildProcess, why: string): void {
    for (const [id, p] of [...this.pending]) {
      if (p.proc !== proc) continue;
      this.pending.delete(id);
      p.reject(new Error(why));
    }
  }

  private onLine(line: string): void {
    let msg: { id: number; result?: unknown; error?: { message: string } };
    try { msg = JSON.parse(line); } catch { return; }
    const p = this.pending.get(msg.id);
    if (!p) return; // aborted or unknown
    this.pending.delete(msg.id);
    if (msg.error) p.reject(new Error(msg.error.message));
    else p.resolve(msg.result);
  }

  /**
   * Calls a sidecar method (named like the tool).
   * @param method - method name
   * @param params - JSON params
   * @param signal - abort rejects this call with `aborted` (the sidecar finishes the work and the reply is dropped)
   * @throws `aborted`, `sidecar crashed`, or the sidecar's error message
   */
  call(method: string, params: Record<string, unknown>, signal?: AbortSignal): Promise<unknown> {
    if (signal?.aborted) return Promise.reject(new Error("aborted"));
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const onAbort = () => {
        if (this.pending.delete(id)) reject(new Error("aborted"));
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      const done = <T>(f: (v: T) => void) => (v: T) => {
        signal?.removeEventListener("abort", onAbort);
        f(v);
      };
      try {
        const proc = this.start();
        this.pending.set(id, { proc, resolve: done(resolve), reject: done(reject) });
        proc.stdin!.write(JSON.stringify({ id, method, params }) + "\n");
      } catch (e) {
        this.pending.delete(id);
        done(reject)(e as Error);
      }
    });
  }

  /** Stops the process; in-flight calls reject with `sidecar crashed`. A later call restarts it. */
  close(): void {
    const proc = this.proc;
    if (!proc) return;
    this.proc = undefined;
    proc.kill("SIGKILL");
    this.failPending(proc, "sidecar crashed");
  }
}

/**
 * The sidecar a tool needs.
 * @throws `no sidecar` when none was given to the catalog
 */
export function needSidecar(sc: Sidecar | undefined): Sidecar {
  if (!sc) throw new Error("no sidecar");
  return sc;
}
