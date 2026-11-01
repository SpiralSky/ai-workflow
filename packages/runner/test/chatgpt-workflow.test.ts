import test from "node:test";
import assert from "node:assert/strict";
import { createChatGPTClient } from "@aiw/llm";
import { createReporter, NoopSink } from "@aiw/telemetry";
import { runLoop } from "../src/loop.ts";
import type { MCPSession } from "../src/mcp.ts";

/** Mock public SSE reply; does not call a model or bind a socket. */
function reply(output: unknown[]): Response {
  return new Response(`data: ${JSON.stringify({ type: "response.completed", response: {
    id: "mock-response", status: "completed", model: "account-model", output,
    usage: { input_tokens: 8, output_tokens: 2, input_tokens_details: { cached_tokens: 4 } },
  } })}\n\n`, { headers: { "content-type": "text/event-stream" } });
}

for (const [framework, name, args] of [["baseline", "readFile", { path: "app.py" }], ["branch-only", "branch", { code: 'await tools.readFile({path:"app.py"})' }]] as const) {
  test(`actual main loop ${framework}: text task → function → result → final, preserving stateless reasoning`, async () => {
    const bodies: any[] = [], invoked: any[] = [];
    const output = [
      { type: "reasoning", id: "rs1", summary: [], encrypted_content: "opaque-fixture" },
      { type: "message", id: "msg1", role: "assistant", phase: "commentary", content: [{ type: "output_text", text: "Inspecting." }] },
      { type: "function_call", id: "fc1", call_id: "call1", namespace: "ai_workflow", name, arguments: JSON.stringify(args) },
    ];
    const client = createChatGPTClient({ accessToken: async () => "mock-token", fetch: (async (_url, init) => {
      bodies.push(JSON.parse(String(init?.body)));
      return bodies.length === 1 ? reply(output) : reply([{ type: "message", id: "msg2", role: "assistant", phase: "final_answer", content: [{ type: "output_text", text: "Inspected successfully." }] }]);
    }) as typeof fetch });
    const session = { tools: [{ name, description: "Fixture tool", inputSchema: { type: "object", properties: {} } }], _client: { callTool: async (request: any) => {
      invoked.push(request);
      return { content: [{ type: "text", text: "fixture source" }], _meta: { "aiw/durationMs": 1 } };
    } } } as unknown as MCPSession;
    const outcome = await runLoop({ client, session, reporter: createReporter({ sink: new NoopSink(), writer: "r" }),
      systemPrompt: "Complete the task", taskText: "Inspect app.py", model: "account-model", temperature: 0,
      turnLimit: 3, framework });
    assert.equal(outcome.outcome, "done");
    assert.equal(outcome.metrics.turns, 2);
    assert.equal(outcome.metrics.toolCalls, 1);
    assert.equal(outcome.metrics.costUsd, null, "subscription usage is not free dollar usage");
    assert.equal(invoked.length, 1);
    assert.equal(invoked[0].name, name);
    assert.deepEqual(invoked[0].arguments, args);
    assert.deepEqual(bodies[1].input.slice(1, 4), output, "reasoning, phase and tool call all replay exactly once");
    assert.deepEqual(bodies[1].input[4], { type: "function_call_output", call_id: "call1", output: "fixture source\n[tool time: 1 ms]" });
    assert.ok(bodies.every(body => body.store === false && body.stream === true && !Object.hasOwn(body, "temperature")));
    assert.ok(!JSON.stringify(bodies).includes("mock-token"));
  });
}

test("main loop never executes a partial function call when subscription fails mid-stream", async () => {
  let stopped = 0, tools = 0;
  const client = createChatGPTClient({ accessToken: async () => "mock", fetch: (async () => new Response([
    { type: "response.output_item.done", item: { type: "function_call", call_id: "c", name: "readFile", arguments: "{}" } },
    { type: "response.failed", response: { error: { code: "subscription_sharing_usage_limit_exceeded" } } },
  ].map(event => `data: ${JSON.stringify(event)}\n\n`).join(""), { headers: { "content-type": "text/event-stream" } })) as typeof fetch });
  const outcome = await runLoop({ client, session: { tools: [], _client: { callTool: async () => { tools++; return {}; } } } as unknown as MCPSession,
    reporter: createReporter({ sink: new NoopSink(), writer: "r" }), systemPrompt: "Test", taskText: "Test", model: "account-model", temperature: 0,
    turnLimit: 3, framework: "baseline", onInfraError: () => { stopped++; } });
  assert.equal(outcome.outcome, "infra-error");
  assert.equal(tools, 0);
  assert.equal(stopped, 1);
});
