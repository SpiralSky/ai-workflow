import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test("server shares telemetry counter and parent correlation across successive requests", async (t) => {
  const root = mkdtempSync(join(tmpdir(), "aiw-server-telemetry-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const eventsPath = join(root, "events.jsonl");
  const client = new Client({ name: "fixture", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["--import", "tsx", fileURLToPath(new URL("../src/cli.ts", import.meta.url)), "--framework", "branch-only", "--root", root, "--events", eventsPath], stderr: "pipe" });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    const observed = listed._meta?.["aiw/runtimeProvenance"] as any;
    assert.equal(observed.engine, "quickjs"); // Actual default runtime, not the runner's requested native flag.
    assert.match(observed.entryHash, /^[a-f0-9]{64}$/);
    assert.equal(observed.nodeVersion, process.version);
    assert.equal(observed.runtimePlatform.moduleABI, process.versions.modules);
    for (const name of ["executor", "rerank", "base"]) assert.match(observed.prompts[name], /^[a-f0-9]{64}$/);
    assert.match(observed.catalogHash, /^[a-f0-9]{64}$/);
    for (const n of [1, 2]) {
      const result = await client.callTool({ name: "branch", arguments: { code: 'async (tools) => await tools.bash({ cmd: "printf fixture" })' },
        _meta: { "aiw/parent": `r:${n}`, "aiw/harnessId": `call-${n}` } });
      assert.notEqual(result.isError, true);
    }
  } finally { await client.close(); }
  const events = readFileSync(eventsPath, "utf8").trim().split("\n").map((line) => JSON.parse(line));
  const tools = events.filter((e) => e.kind === "tool");
  assert.equal(tools.length, 2);
  assert.equal(new Set(tools.map((e) => e.id)).size, 2);
  assert.ok(events.some((e) => e.parent === "r:1"));
  assert.ok(events.some((e) => e.parent === "r:2"));
});

test("MCP cancellation reaches the actual server host request", { timeout: 10_000 }, async (t) => {
  const { existsSync } = await import("node:fs");
  const { setTimeout: delay } = await import("node:timers/promises");
  const root = mkdtempSync(join(tmpdir(), "aiw-server-cancel-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const started = join(root, "started"), cancelled = join(root, "cancelled");
  const source = `
    import { startServer } from ${JSON.stringify(new URL("../src/server.ts", import.meta.url).href)};
    import { writeFileSync } from 'node:fs';
    await startServer({ kind: 'baseline', host: {
      tools: async () => [{ name: 'wait', description: 'Fixture only', inputSchema: {}, meta: { effect: 'read', whenToUse: 'wait' } }],
      call: async (_req, ctx) => {
        writeFileSync(${JSON.stringify(started)}, 'started');
        return new Promise((_resolve, reject) => {
          const abort = () => { writeFileSync(${JSON.stringify(cancelled)}, 'cancelled'); reject(new Error('cancelled')); };
          ctx.signal.addEventListener('abort', abort, { once: true });
          if (ctx.signal.aborted) abort();
        });
      }, close: async () => {}
    } });`;
  const client = new Client({ name: "fixture", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["--import", "tsx", "--input-type=module", "-e", source], stderr: "pipe" });
  const controller = new AbortController();
  try {
    await client.connect(transport);
    const request = client.callTool({ name: "wait", arguments: {} }, undefined, { signal: controller.signal });
    const rejected = assert.rejects(request, /campaign stopped/);
    const until = Date.now() + 5000;
    while (!existsSync(started) && Date.now() < until) await delay(10);
    assert.ok(existsSync(started), "host received request before cancellation");
    controller.abort(new Error("campaign stopped"));
    await rejected;
    while (!existsSync(cancelled) && Date.now() < until) await delay(10);
    assert.equal(readFileSync(cancelled, "utf8"), "cancelled");
  } finally { controller.abort(); await client.close(); }
});
