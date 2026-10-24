import type { Sidecar } from "../../sidecar.ts";
import type { ToolDef } from "../../types.ts";
import { makeCoverage } from "./coverage.ts";
import { makeListTests } from "./listTests.ts";
import { makeRunSnippet } from "./runSnippet.ts";
import { makeRunTests } from "./runTests.ts";
import { makeStressRun } from "./stressRun.ts";
import { makeTraceCalls } from "./traceCalls.ts";

/** The `test` group in tools.md §6.5 order, bound to a sidecar. */
export function testTools(sc?: Sidecar): ToolDef[] {
  return [makeRunTests(sc), makeListTests(sc), makeCoverage(sc), makeRunSnippet(sc), makeTraceCalls(sc), makeStressRun(sc)];
}
