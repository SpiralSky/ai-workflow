import type { Sidecar } from "../../sidecar.ts";
import type { ToolDef } from "../../types.ts";
import { makeListTests } from "./listTests.ts";
import { makeRunSnippet } from "./runSnippet.ts";
import { makeRunTests } from "./runTests.ts";

/**
 * The built part of the `test` group (`runTests`, `listTests`, `runSnippet`) bound to a sidecar.
 * `coverage`, `traceCalls` and `stressRun` are added when they exist.
 */
export function testTools(sc?: Sidecar): ToolDef[] {
  return [makeRunTests(sc), makeListTests(sc), makeRunSnippet(sc)];
}
