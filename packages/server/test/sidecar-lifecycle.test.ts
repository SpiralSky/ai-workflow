import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { Sidecar } from "@aiw/tools";

const snippet = `import os, sys, subprocess, time, json
child = subprocess.Popen([sys.executable, "-c", "import time; time.sleep(60)"])
with open("owned-pids.json", "w") as f:
    json.dump([os.getpid(), child.pid], f)
time.sleep(60)`;

/** A reaped or zombie process cannot continue workspace execution. */
function running(pid: number): boolean {
  try {
    process.kill(pid, 0);
    if (process.platform === "linux") {
      const state = readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.split(" ")[0];
      return state !== "Z" && state !== "X";
    }
    return true;
  } catch (error) {
    if (["ESRCH", "ENOENT"].includes((error as NodeJS.ErrnoException).code ?? "")) return false;
    throw error;
  }
}

/** Wait for fixture evidence, bounded to catch a broken lifecycle rather than sleep blindly. */
async function until(predicate: () => boolean): Promise<void> {
  const deadline = Date.now() + 5_000;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, "timed out waiting for owned process lifecycle");
    await delay(20);
  }
}

/** Return the verified analysis interpreter environment, without forwarding model credentials. */
function environment(): Record<string, string> {
  const venv = [process.env.AIW_VENV, fileURLToPath(new URL("../../tools/.venv", import.meta.url)), "/opt/aiw/venv"]
    .find(path => path && existsSync(join(path, "bin/python")));
  assert.ok(venv, "Set AIW_VENV to a verified tool venv for lifecycle regressions");
  return { PATH: process.env.PATH ?? "", AIW_VENV: venv };
}

for (const shutdown of ["sidecar-close", "server-eof", "server-sigterm"] as const) {
  test(`${shutdown} stops the owned workspace child and grandchild`, { timeout: 15_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "aiw-lifecycle-"));
    const path = join(root, "owned-pids.json");
    let pids: number[] = [];
    let cleanup = async () => {};
    try {
      if (shutdown === "sidecar-close") {
        const sidecar = new Sidecar({ root, env: environment() });
        cleanup = () => sidecar.close();
        const inflight = sidecar.call("runSnippet", { code: snippet, timeoutMs: 60_000 });
        const rejected = assert.rejects(inflight, /sidecar crashed/);
        await until(() => existsSync(path));
        pids = JSON.parse(readFileSync(path, "utf8"));
        await sidecar.close();
        await rejected;
      } else {
        const child = spawn(process.execPath, [fileURLToPath(new URL("../dist/aiw-server.mjs", import.meta.url)),
          "--framework", "baseline", "--tier", "L", "--root", root], { env: environment(), stdio: ["pipe", "pipe", "pipe"] });
        let stderr = "";
        child.stderr.on("data", chunk => { stderr += String(chunk); });
        const exited = new Promise<{code:number|null; signal:NodeJS.Signals|null}>(resolve => child.once("close", (code, signal) => resolve({ code, signal })));
        cleanup = async () => {
          if (child.exitCode !== null || child.signalCode !== null) return;
          child.kill("SIGTERM");
          const timer = setTimeout(() => child.kill("SIGKILL"), 2_000);
          try { await exited; } finally { clearTimeout(timer); }
        };
        const lines = createInterface({ input: child.stdout });
        const initialized = new Promise<void>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", () => reject(new Error(`server closed before initialize: ${stderr}`)));
          lines.on("line", line => {
            const reply = JSON.parse(line);
            if (reply.id === 1) reply.error ? reject(new Error(JSON.stringify(reply.error))) : resolve();
          });
        });
        child.stdin.write(JSON.stringify({ jsonrpc:"2.0", id:1, method:"initialize", params:{protocolVersion:"2024-11-05",capabilities:{},clientInfo:{name:"lifecycle-fixture",version:"1"}} }) + "\n");
        await initialized;
        child.stdin.write(JSON.stringify({ jsonrpc:"2.0", method:"notifications/initialized" }) + "\n");
        child.stdin.write(JSON.stringify({ jsonrpc:"2.0", id:2, method:"tools/call", params:{name:"runSnippet",arguments:{code:snippet,timeoutMs:60_000}} }) + "\n");
        await until(() => existsSync(path));
        pids = JSON.parse(readFileSync(path, "utf8"));
        if (shutdown === "server-eof") child.stdin.end(); else child.kill("SIGTERM");
        await until(() => child.exitCode !== null || child.signalCode !== null);
        const result = await exited;
        assert.equal(result.signal, null, stderr);
        assert.equal(result.code, shutdown === "server-eof" ? 0 : 143, stderr);
      }
      await until(() => pids.every(pid => !running(pid)));
    } finally {
      await cleanup();
      // Fixture-only emergency cleanup if a regression leaves its known child session alive.
      if (pids[0] && pids.some(running)) {
        try { process.kill(-pids[0], "SIGKILL"); } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ESRCH") throw error;
        }
      }
      rmSync(root, { recursive: true, force: true });
    }
  });
}
