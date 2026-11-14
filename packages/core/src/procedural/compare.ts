import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";
import { createProcedureSelector, procedures } from "./index.ts";

/** One independent offline procedure-selection intent, not a reported problem prompt. */
export interface ProcedureCase { id: string; intent: string; expected: string; }
/** Run all selectors with deterministic stub classification; no provider is constructed. */
export async function compareProcedureSelectors(cases: ProcedureCase[]) {
  const rows = [];
  for (const selector of ["flat", "tree", "bm25"] as const) {
    for (const entry of cases) {
      const result = await createProcedureSelector(selector).select(entry.intent, procedures);
      rows.push({ selector, caseId: entry.id, found: result.candidates.includes(entry.expected), selected: result.candidates, selectionRequests: result.requests.length, inputBytesPerRequest: result.requests.map(x => x.inputBytes) });
    }
  }
  return { scope: "offline deterministic lexical classifier stub and BM25 development comparison; not model accuracy", costSaving: "not measured", rows };
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const cases: ProcedureCase[] = JSON.parse(await readFile(new URL("../../../../experiments/selection/procedural-cases.json", import.meta.url), "utf8"));
  console.log(JSON.stringify(await compareProcedureSelectors(cases), null, 2));
}
