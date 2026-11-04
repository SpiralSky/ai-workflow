import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";
import { LLM_COST_INCOMPLETE_KEY } from "@aiw/telemetry";

for (const entry of ["source", "bundle"] as const) {
test(`${entry} server shares telemetry counter and parent correlation across successive requests`, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "aiw-server-telemetry-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const eventsPath = join(root, "events.jsonl");
  const client = new Client({ name: "fixture", version: "1" });
  const transport = new StdioClientTransport({ command: process.execPath,
    args: [...(entry === "source"
      ? ["--import", "tsx", fileURLToPath(new URL("../src/cli.ts", import.meta.url))]
      : [fileURLToPath(new URL("../dist/aiw-server.mjs", import.meta.url))]),
      "--framework", "branch-only", "--root", root, "--events", eventsPath], stderr: "pipe" });
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

test(`${entry} server preserves recovered selection failure uncertainty`, async (t) => {
  const root = mkdtempSync(join(tmpdir(), "aiw-server-cost-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const eventsPath = join(root, "events.jsonl"), preload = join(root, "scripted-fetch.mjs");
  // Stub the fetch boundary before loading either artifact. No network/provider request is made.
  writeFileSync(preload, `
    let secondary = 0;
    globalThis.fetch = async (url, opts) => {
      if (url !== 'https://fixture.invalid/v1/chat/completions') throw new Error('Unexpected fixture URL');
      const body = JSON.parse(opts.body);
      if (!body.tools?.length) throw new Error('selection request lost after dispatch');
      const message = ++secondary === 1
        ? {tool_calls:[{id:'inner',type:'function',function:{name:'branch',arguments:JSON.stringify({code:'async (tools) => await tools.findTools({need:"read contents file"})'})}}]}
        : {content:'Ending after failed tool search.'};
      return new Response(JSON.stringify({choices:[{message}],usage:{prompt_tokens:1,completion_tokens:1,cost:1}}));
    };
  `);
  const client = new Client({ name: "fixture", version: "1" });
  const args = entry === "source"
    ? ["--import", "tsx", fileURLToPath(new URL("../src/cli.ts", import.meta.url))]
    : [fileURLToPath(new URL("../dist/aiw-server.mjs", import.meta.url))];
  const transport = new StdioClientTransport({ command: process.execPath,
    args: ["--import", preload, ...args, "--framework", "orchestrate", "--root", root, "--events", eventsPath,
      "--executor-model", "fixture", "--executor-api-key", "fixture", "--executor-base-url", "https://fixture.invalid/v1"], stderr: "pipe" });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name: "do", arguments: { instruction: "Inspect task", tools: ["bash"] } });
    assert.equal(result.isError, false);
  } finally { await client.close(); }
  const events = readFileSync(eventsPath, "utf8").trim().split("\n").map(line => JSON.parse(line));
  assert.equal(events.filter(event => event.kind === "turn" && event.role === "secondary").length, 2);
  assert.equal(events.filter(event => event.kind === "turn" && event.role === "selection").length, 0);
  assert.equal(events.filter(event => event.kind === "attach" && event.key === LLM_COST_INCOMPLETE_KEY).length, 1);
});
}
