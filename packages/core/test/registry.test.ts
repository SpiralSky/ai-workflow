import test from "node:test";
import assert from "node:assert/strict";
import { buildRegistry, normalizeName } from "../src/registry/index.ts";
import { BM25Index, cosine, tokenize } from "../src/selection/index.ts";
import type { HostToolDecl } from "../src/registry/index.ts";

const decl = (name: string, description = "does a thing", extra: Partial<HostToolDecl> = {}): HostToolDecl => ({
  name,
  description,
  inputSchema: { type: "object" },
  ...extra,
});

test("normalizeName examples", () => {
  const cases: [string, string][] = [
    ["mcp__github__create_issue", "github_createIssue"],
    ["mcp__my-server__list_all_items", "myserver_listAllItems"],
    ["Bash", "bash"],
    ["WebFetch", "webFetch"],
    ["read_file", "readFile"],
    ["read-file", "readFile"],
    ["readFile", "readFile"],
    ["9lives", "_9lives"],
    ["a.b!c", "abc"],
  ];
  for (const [from, to] of cases) assert.equal(normalizeName(from), to, from);
});

test("collision throws naming both host names", () => {
  assert.throws(() => buildRegistry([decl("read_file"), decl("read-file")]), /read_file.*read-file/);
});

test("defaults and order", () => {
  const r = buildRegistry([decl("b_tool", "B desc"), decl("a_tool", "A desc", { meta: { effect: "read", category: "x" }, routing: "direct", returns: "string" })], { warn: () => {} });
  assert.deepEqual(r.decls.map((d) => d.name), ["bTool", "aTool"]);
  const b = r.byHostName.get("b_tool")!;
  assert.equal(b.routing, "routed");
  assert.equal(b.returns, "unknown");
  assert.equal(b.meta.effect, "write");
  assert.equal(b.meta.whenToUse, "B desc");
  assert.equal(r.byName.get("bTool"), b);
  const a = r.byName.get("aTool")!;
  assert.equal(a.meta.effect, "read");
  assert.equal(a.meta.category, "x");
  assert.equal(a.routing, "direct");
  assert.equal(a.returns, "string");
  assert.deepEqual(a.parameters, { type: "object" });
});

test("similarity warning fires for near-duplicates only", () => {
  const warnings: string[] = [];
  buildRegistry(
    [
      decl("search_files", "Search the workspace for files matching a glob pattern"),
      decl("find_files", "Search the workspace for files matching a glob pattern"),
      decl("send_email", "Deliver an email message to a recipient over SMTP"),
    ],
    { warn: (m) => warnings.push(m) },
  );
  assert.equal(warnings.length, 1);
  assert.match(warnings[0]!, /searchFiles/);
  assert.match(warnings[0]!, /findFiles/);
  const none: string[] = [];
  buildRegistry([decl("read_file", "Read a file from disk"), decl("send_email", "Deliver an email message to a recipient")], { warn: (m) => none.push(m) });
  assert.equal(none.length, 0);
});

test("tokenize", () => {
  assert.deepEqual(tokenize("findFiles"), ["find", "files"]);
  assert.deepEqual(tokenize("github_createIssue"), ["github", "create", "issue"]);
  assert.deepEqual(tokenize("Read the HTTPServer-log2"), ["read", "the", "http", "server", "log2"]);
});

test("BM25Index scores and vectors", () => {
  const idx = new BM25Index([
    { id: "a", text: "read a file from disk" },
    { id: "b", text: "send an email" },
  ]);
  const s = idx.score("read file");
  assert.deepEqual(s.map((x) => x.id), ["a"]);
  assert.ok(s[0]!.score > 0);
  assert.ok(idx.vector("a").get("read")! > 0);
  assert.equal(cosine(idx.vector("a"), idx.vector("a")).toFixed(6), "1.000000");
  assert.equal(cosine(idx.vector("a"), idx.vector("b")), 0);
});
