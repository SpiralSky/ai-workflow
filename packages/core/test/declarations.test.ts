import test from "node:test";
import assert from "node:assert/strict";
import { declarations, schemaToTS } from "../src/registry/declarations.ts";
import type { ToolDecl } from "../src/registry/types.ts";

const meta = { whenToUse: "", effect: "read" as const };
/** Builds a minimal ToolDecl. */
const tool = (name: string, description: string, parameters: any, returns = "unknown", hostName = name): ToolDecl => ({
  name, hostName, description, parameters, returns, routing: "routed", capsOutput: false, meta,
});

test("primitives, integer, null, const, enum", () => {
  assert.equal(schemaToTS({ type: "string" }), "string");
  assert.equal(schemaToTS({ type: "integer" }), "number");
  assert.equal(schemaToTS({ type: "boolean" }), "boolean");
  assert.equal(schemaToTS({ type: "null" }), "null");
  assert.equal(schemaToTS({ const: "x" }), '"x"');
  assert.equal(schemaToTS({ enum: ["a", 1, null] }), '"a" | 1 | null');
});

test("type arrays, anyOf, oneOf, empty schema", () => {
  assert.equal(schemaToTS({ type: ["string", "null"] }), "string | null");
  assert.equal(schemaToTS({ anyOf: [{ type: "string" }, { type: "number" }] }), "string | number");
  assert.equal(schemaToTS({ oneOf: [{ const: 1 }, { type: "boolean" }] }), "1 | boolean");
  assert.equal(schemaToTS({}), "unknown");
});

test("arrays parenthesise unions", () => {
  assert.equal(schemaToTS({ type: "array", items: { type: "string" } }), "string[]");
  assert.equal(schemaToTS({ type: "array", items: { type: ["string", "null"] } }), "(string | null)[]");
  assert.equal(schemaToTS({ type: "array", items: { enum: ["a", "b"] } }), '("a" | "b")[]');
  assert.equal(schemaToTS({ type: "array" }), "unknown[]");
  assert.equal(schemaToTS({ type: "array", items: { type: "object", properties: { a: { enum: ["x", "y"] } }, required: ["a"] } }), '{ a: "x" | "y" }[]');
});

test("objects: required, optional, index signatures", () => {
  assert.equal(
    schemaToTS({ type: "object", properties: { a: { type: "string" }, b: { type: "number" } }, required: ["a"] }),
    "{ a: string; b?: number }",
  );
  assert.equal(schemaToTS({ type: "object" }), "{}");
  assert.equal(schemaToTS({ type: "object", additionalProperties: true }), "{ [key: string]: unknown }");
  assert.equal(schemaToTS({ type: "object", additionalProperties: { type: "number" } }), "{ [key: string]: number }");
});

test("property descriptions become JSDoc", () => {
  const out = schemaToTS({ type: "object", properties: { path: { type: "string", description: "File path" }, n: { type: "number" } }, required: ["path"] });
  assert.equal(out, "{\n  /** File path */\n  path: string;\n  n?: number;\n}");
});

test("nested objects indent", () => {
  const out = schemaToTS({ type: "object", properties: { o: { type: "object", properties: { x: { type: "string", description: "d" } } } } });
  assert.equal(out, "{\n  o?: {\n    /** d */\n    x?: string;\n  };\n}");
});

test("unsupported constructs degrade without throwing", () => {
  assert.equal(schemaToTS({ $ref: "#/x" }), "unknown /* unsupported: $ref */");
  assert.equal(schemaToTS({ allOf: [{}] }), "unknown /* unsupported: allOf */");
  assert.equal(schemaToTS({ not: {} }), "unknown /* unsupported: not */");
  assert.equal(schemaToTS({ patternProperties: {} }), "unknown /* unsupported: patternProperties */");
  assert.equal(
    schemaToTS({ type: "object", properties: { a: { $ref: "#" } }, required: ["a"] }),
    "{ a: unknown /* unsupported: $ref */ }",
  );
  assert.doesNotThrow(() => schemaToTS(null as any));
});

test("BF 6.4 example shape", () => {
  const out = declarations([
    tool("readFile", "Read a file as UTF-8 text.", { type: "object", properties: { path: { type: "string" } }, required: ["path"] }, "string"),
    tool("bash", "Run a shell command.", { type: "object", properties: { cmd: { type: "string" }, timeoutMs: { type: "number" } }, required: ["cmd"] }, "{ code: number; out: string }"),
  ]);
  assert.equal(
    out,
    [
      "/** Read a file as UTF-8 text. */",
      "readFile(args: { path: string }): Promise<string>;",
      "/** Run a shell command. */",
      "bash(args: { cmd: string; timeoutMs?: number }): Promise<{ code: number; out: string }>;",
    ].join("\n"),
  );
});

test("host name comment only when it differs; catalog order kept", () => {
  const out = declarations([
    tool("zeta", "Z", {}, "unknown"),
    tool("github_createIssue", "Create an issue.", { type: "object" }, "unknown", "mcp__github__create_issue"),
  ]);
  assert.ok(out.indexOf("zeta") < out.indexOf("github_createIssue"));
  assert.ok(out.includes("// host: mcp__github__create_issue\ngithub_createIssue("));
  assert.equal(out.match(/\/\/ host:/g)!.length, 1);
});

test("maxChars with priority", () => {
  const ds = ["a", "b", "c", "d"].map((n) => tool(n, `Tool ${n}.`, { type: "object" }));
  const full = declarations(ds);
  assert.equal(declarations(ds, { maxChars: full.length }), full);
  const one = declarations([ds[0]]).length;
  const max = one * 2 + 92;
  const out = declarations(ds, { maxChars: max, priority: ["d", "b"] });
  assert.ok(out.length <= max, `${out.length} > ${max}`);
  assert.ok(out.includes("d(args"));
  assert.ok(out.includes("b(args"));
  assert.ok(out.indexOf("b(args") < out.indexOf("d(args"), "catalog order among included");
  assert.ok(!out.includes("a(args"));
  const last = out.split("\n").at(-1)!;
  assert.match(last, /a, c/);
  assert.match(last, /tools\.tools\(\{ names \}\)/);
});

test("maxChars too small yields only the omission line", () => {
  const ds = [tool("a", "A", { type: "object" })];
  const out = declarations(ds, { maxChars: 10 });
  assert.match(out, /^\/\/ 1 more tools not shown: a\./);
});
