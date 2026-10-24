import { BM25Index, cosine } from "../selection/bm25.ts";
import { normalizeName } from "./normalize.ts";
import type { HostToolDecl, Registry, ToolDecl } from "./types.ts";

const SIMILARITY_THRESHOLD = 0.8;

/**
 * Builds the registry from host tool declarations (core-tools-and-hosts §2): normalises names,
 * applies defaults (routing `routed`, returns `unknown`, effect `write`, whenToUse = description)
 * and warns about near-duplicate tools.
 * @param hostDecls - tools as listed by the host, in catalog order
 * @param opts - `warn` receives similarity warnings (default `console.warn`)
 * @returns the registry, preserving host order
 * @throws Error when two host names normalise to the same name
 */
export function buildRegistry(hostDecls: HostToolDecl[], opts: { warn?: (msg: string) => void } = {}): Registry {
  const warn = opts.warn ?? ((m: string) => console.warn(m));
  const decls: ToolDecl[] = [];
  const byName = new Map<string, ToolDecl>();
  const byHostName = new Map<string, ToolDecl>();
  for (const h of hostDecls) {
    const name = normalizeName(h.name);
    const prior = byName.get(name);
    if (prior) {
      throw new Error(`Tool name collision: host tools "${prior.hostName}" and "${h.name}" both normalise to "${name}"`);
    }
    const d: ToolDecl = {
      name,
      hostName: h.name,
      description: h.description,
      parameters: h.inputSchema,
      returns: h.returns ?? "unknown",
      routing: h.routing ?? "routed",
      capsOutput: h.capsOutput ?? false,
      meta: { ...h.meta, effect: h.meta?.effect ?? "write", whenToUse: h.meta?.whenToUse ?? h.description },
    };
    decls.push(d);
    byName.set(name, d);
    byHostName.set(h.name, d);
  }
  warnSimilar(decls, warn);
  return { decls, byName, byHostName };
}

/** Logs a warning for every pair of tools whose BM25 term vectors have cosine similarity > 0.8. */
function warnSimilar(decls: ToolDecl[], warn: (msg: string) => void): void {
  const text = (d: ToolDecl) => [d.name, d.description, d.meta.whenToUse, ...(d.meta.examples ?? [])].join("\n");
  const index = new BM25Index(decls.map((d) => ({ id: d.name, text: text(d) })));
  const vecs = decls.map((d) => index.vector(d.name));
  for (let i = 0; i < decls.length; i++) {
    for (let j = i + 1; j < decls.length; j++) {
      const sim = cosine(vecs[i]!, vecs[j]!);
      if (sim > SIMILARITY_THRESHOLD) {
        warn(`Tools "${decls[i]!.name}" and "${decls[j]!.name}" are very similar (cosine ${sim.toFixed(2)}); selection may confuse them`);
      }
    }
  }
}
