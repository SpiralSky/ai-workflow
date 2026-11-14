import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, writeFile, readFile, mkdir, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProcedureSelector, executeProcedure, fillProcedureArguments, procedures, pythonProcedureTools } from "../src/procedural/index.ts";

const rename = procedures[0]!;
/** Create a small real Python fixture; no model or provider participates. */
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "aiw-procedure-"));
  await mkdir(join(root, "tests"));
  await writeFile(join(root, "item.py"), 'class Widget:\n    pass\n\nkey = "Widget"\n');
  await writeFile(join(root, "tests/test_item.py"), 'import unittest\nfrom item import Gadget, key\nclass Check(unittest.TestCase):\n    def test_value(self):\n        self.assertEqual(key, "Widget")\n        self.assertIsNotNone(Gadget())\n');
  return root;
}
test("deterministic rename preserves strings and runs real Python checks", async () => {
  const root = await fixture();
  const result = await executeProcedure(rename, root, { oldName: "Widget", newName: "Gadget", paths: ["item.py"], testDirs: ["tests"] }, pythonProcedureTools);
  assert.equal(result.status, "completed", JSON.stringify(result));
  assert.deepEqual(result.completed, ["inspect", "rename", "check"]);
  assert.match(await readFile(join(root, "item.py"), "utf8"), /class Gadget/);
  assert.match(await readFile(join(root, "item.py"), "utf8"), /"Widget"/);
});
test("missing input returns before effects; malformed input fails", async () => {
  const root = await fixture();
  assert.equal((await executeProcedure(rename, root, {}, pythonProcedureTools)).status, "needs-input");
  assert.equal((await executeProcedure(rename, root, { oldName: "not valid", newName: "X", paths: ["item.py"], testDirs: ["tests"] }, pythonProcedureTools)).status, "failed");
});
test("path escape and symlink are rejected before mutation", async () => {
  const root = await fixture();
  await symlink(join(root, "item.py"), join(root, "linked.py"));
  for (const paths of [["../outside"], ["linked.py"]]) {
    const result = await executeProcedure(rename, root, { oldName: "Widget", newName: "Gadget", paths, testDirs: ["tests"] }, pythonProcedureTools);
    assert.equal(result.status, "does-not-fit");
  }
  assert.match(await readFile(join(root, "item.py"), "utf8"), /class Widget/);
});
test("absent symbol is ordinary no-fit; failed checks retain partial edits", async () => {
  const root = await fixture();
  assert.equal((await executeProcedure(procedures[1]!, root, { symbol: "Absent", paths: ["item.py"] }, pythonProcedureTools)).status, "does-not-fit");
  await writeFile(join(root, "tests/test_item.py"), 'import unittest\nclass Check(unittest.TestCase):\n    def test_fail(self):\n        self.fail("expected")\n');
  const result = await executeProcedure(rename, root, { oldName: "Widget", newName: "Gadget", paths: ["item.py"], testDirs: ["tests"] }, pythonProcedureTools);
  assert.equal(result.status, "failed");
  assert.deepEqual(result.completed, ["inspect", "rename"]);
});
test("invalid dependencies and unknown tools fail before execution", async () => {
  const root = await fixture();
  const broken = { ...rename, steps: [{ ...rename.steps[0]!, dependsOn: ["later"] }] };
  assert.equal((await executeProcedure(broken, root, {}, pythonProcedureTools)).status, "failed");
  assert.equal((await executeProcedure(rename, root, {}, {})).status, "failed");
});
test("argument filler cannot replace known values", async () => {
  const known = { oldName: "Widget", paths: ["item.py"], testDirs: ["tests"] };
  const inputs = await fillProcedureArguments(rename, known, "rename", { async fill() { return { newName: "Gadget" }; } });
  assert.equal(inputs.oldName, "Widget");
  await assert.rejects(fillProcedureArguments(rename, known, "rename", { async fill() { return { oldName: "Other", newName: "Gadget" }; } }));
});
for (const kind of ["flat", "tree", "bm25"] as const) test(`${kind} offline selector finds rename and records actual request bytes`, async () => {
  const result = await createProcedureSelector(kind).select("rename known Python symbol identifier", procedures);
  assert.ok(result.candidates.includes("rename-known-symbol"));
  assert.ok(result.requests.every(x => x.inputBytes > 0));
  assert.equal(result.requests.length, kind === "tree" ? 2 : 1);
});
test("tree explores only high-scoring branches; invalid classifier output rejects", async () => {
  const result = await createProcedureSelector("tree", { async classify(request) { return request.choices.map(x => ({ id: x.id, score: 1 })); } }).select("ambiguous", procedures);
  assert.equal(result.requests.length, 4);
  assert.equal(result.candidates.length, 3);
  await assert.rejects(createProcedureSelector("flat", { async classify() { return [{ id: "unknown", score: 1 }]; } }).select("x", procedures));
});
test("lexical stub has explicit no-fit result for unrelated input", async () => {
  for (const kind of ["flat", "tree", "bm25"] as const) assert.deepEqual((await createProcedureSelector(kind).select("orchard mango sunrise", procedures)).candidates, []);
});
