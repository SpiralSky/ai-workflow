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
