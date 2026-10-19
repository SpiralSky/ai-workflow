// Extracted delegate handler — importable without the MCP server side-effects.
import { loadCatalog, buildBM25Index, search } from "./catalog.js";
import { orchestrate } from "./orchestrator.js";
import { defaultLimits } from "./runner.js";
import type { Session } from "./helpers.js";
import type { Limits } from "./runner.js";
import type { ToolEntry, BM25Index } from "./catalog.js";
import type { OrchestratorDeps } from "./orchestrator.js";

const TOP_K = parseInt(process.env.BRANCH_DELEGATE_TOP_K ?? "8");

// Module-level cache so long-running server doesn't rebuild on every call.
let _catalog: ToolEntry[] | undefined;
let _index: BM25Index | undefined;
function getCatalogIndex(): { catalog: ToolEntry[]; index: BM25Index } {
  if (!_catalog || !_index) {
    _catalog = loadCatalog();
    _index = buildBM25Index(_catalog);
  }
  return { catalog: _catalog, index: _index };
}

export interface DelegateDeps {
  getCatalogIndexFn?: () => { catalog: ToolEntry[]; index: BM25Index };
  searchFn?: (task: string, index: BM25Index, topK?: number) => ToolEntry[];
  orchestrateFn?: (
    task: string,
    policy: string | undefined,
    shortlist: ToolEntry[],
    session: Session,
    limits: Limits,
    deps?: OrchestratorDeps,
  ) => Promise<string>;
  orchestratorDeps?: OrchestratorDeps;
}

export async function handleDelegate(
  task: string,
  policy: string | undefined,
  session: Session,
  limits: Limits = defaultLimits,
  deps: DelegateDeps = {},
): Promise<string> {
  const getCatalogIndexFn = deps.getCatalogIndexFn ?? getCatalogIndex;
  const searchFn = deps.searchFn ?? search;
  const orchestrateFn = deps.orchestrateFn ?? orchestrate;

  try {
    const { index } = getCatalogIndexFn();
    const shortlist = searchFn(task, index, TOP_K);
    return await orchestrateFn(task, policy, shortlist, session, limits, deps.orchestratorDeps);
  } catch (e: any) {
    return `Delegate error: ${String(e?.message ?? e)}`;
  }
}
