import test from "node:test";
import assert from "node:assert/strict";
import { parseFrameworkVariant } from "../src/index.ts";

test("variant ids are canonical and preserve effective settings", () => {
  assert.deepEqual(parseFrameworkVariant(" orchestrate[ secondary=2, rerank=none, catalog=50 ] "), {
    kind: "orchestrate", variant: { secondary: 2, rerank: "none", catalog: 50 },
    id: "orchestrate[catalog=50,rerank=none,secondary=2]",
  });
  assert.equal(parseFrameworkVariant("baseline[]").id, "baseline");
  assert.equal(parseFrameworkVariant("branch-only[toolSearch,catalog=50]").id, "branch-only[catalog=50,toolSearch]");
});

for (const id of [
  "unknown", "orchestrate[rerank=none", "orchestrate]", "orchestrate[[rerank=none]]", "orchestrate[rerank=none]tail",
  "orchestrate[rerank=none,rerank=llm]", "orchestrate[rerank=none,]", "orchestrate[,rerank=none]",
  "orchestrate[rerank=unknown]", "orchestrate[typo=none]", "orchestrate[secondary]", "orchestrate[secondary=0]",
  "orchestrate[secondary=-1]", "orchestrate[secondary=2x]", "orchestrate[secondary=1.5]",
  "orchestrate[secondary=9007199254740992]", "baseline[rerank=none]", "branch-only[secondary=2]",
  "orchestrate[toolSearch]", "branch-only[toolSearch=false]", "baseline[catalog=0]", "baseline[catalog=2junk]",
  "orchestrate[hotPaths]", "orchestrate[executor=calls]", "orchestrate[executor=unknown]", "orchestrate[rerank=none=x]",
]) {
  test(`variant rejects unsupported or malformed treatment ${id}`, () => assert.throws(() => parseFrameworkVariant(id)));
}
