import test from "node:test";
import assert from "node:assert/strict";
import { frameworkLaunch } from "../src/framework-launch.ts";
import type { RunConfig } from "../src/types.ts";

const config = { models: { main: "main", secondary: "secondary" }, secondaryCap: 4 } as RunConfig;
const credentials = { apiKey: "fixture-not-a-secret", baseURL: "https://example.invalid" };

test("all orchestrate variants get executor launch settings and network classification", () => {
  for (const id of ["orchestrate", "orchestrate[rerank=none]", "orchestrate[catalog=50]", "orchestrate[secondary=2,rerank=llm]"]) {
    const launch = frameworkLaunch(id, config, credentials);
    assert.equal(launch.needsExecutor, true);
    assert.deepEqual(launch.executorArgs, ["--executor-model", "secondary", "--executor-api-key", credentials.apiKey,
      "--executor-base-url", credentials.baseURL, "--secondary-cap", id.includes("secondary=2") ? "2" : "4"]);
  }
});

test("other frameworks never receive executor credentials or executor network classification", () => {
  for (const id of ["baseline", "baseline[catalog=50]", "branch-only", "branch-only[toolSearch]"]) {
    const launch = frameworkLaunch(id, config, credentials);
    assert.equal(launch.needsExecutor, false);
    assert.deepEqual(launch.executorArgs, []);
  }
});

test("unsupported treatment fails before launch options are returned", () => {
  assert.throws(() => frameworkLaunch("orchestrate[typo=none]", config, credentials));
  assert.throws(() => frameworkLaunch("orchestrate[executor=calls]", config, credentials));
});
