import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { executeProcedure } from "@aiw/core/procedural";
import { renameKnownSymbolTierL, tierLProcedureTools } from "../src/procedural.ts";
import { Sidecar } from "../src/index.ts";
import { makeWorkspace, skipReason, venvEnv } from "./pyfixture.ts";

const FILES: Record<string, string> = {
  "app/__init__.py": "",
  "app/models.py": "class Sku:\n    def __init__(self, code: str) -> None:\n        self.code = code\n",
  "app/use.py": "from app.models import Sku\n\n\ndef make() -> Sku:\n    return Sku(\"a\")\n",
};

/** Runs the procedure in a fresh workspace and returns its result and the root. */
async function run(symbol: string) {
  const root = makeWorkspace(FILES);
  const sc = new Sidecar({ root, env: venvEnv() });
  try {
    const result = await executeProcedure(renameKnownSymbolTierL, root, { symbol, newName: "ProductCode", checkPath: "app" }, tierLProcedureTools(sc));
    return { root, result };
  } finally {
    sc.close();
  }
}

test("rename-known-symbol-tierL renames definition and importer", { skip: skipReason }, async () => {
  const { root, result } = await run("app/models.py#Sku");
  assert.equal(result.status, "completed", result.reason ?? "");
  assert.deepEqual(result.completed, ["findReferences", "checkBefore", "renameSymbol", "check"]);
  assert.match(readFileSync(join(root, "app/models.py"), "utf8"), /class ProductCode:/);
  const use = readFileSync(join(root, "app/use.py"), "utf8");
  assert.match(use, /from app.models import ProductCode/);
  assert.doesNotMatch(use, /Sku/);
});

test("rename-known-symbol-tierL does not fit an absent symbol and writes nothing", { skip: skipReason }, async () => {
  const { root, result } = await run("app/models.py#Missing");
  assert.equal(result.status, "does-not-fit");
  assert.deepEqual(result.completed, []);
  assert.equal(readFileSync(join(root, "app/models.py"), "utf8"), FILES["app/models.py"]);
  assert.equal(readFileSync(join(root, "app/use.py"), "utf8"), FILES["app/use.py"]);
});
