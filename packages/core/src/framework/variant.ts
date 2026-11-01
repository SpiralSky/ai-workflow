import type { FrameworkKind } from "./types.ts";

/** Supported, effective experiment treatments; unsupported treatments fail closed. */
export interface FrameworkVariantKeys {
  toolSearch?: boolean;
  catalog?: number;
  rerank?: "llm" | "none" | "classifier";
  secondary?: number;
  hotPaths?: boolean;
  executor?: "branch" | "calls";
}

/** Parses and canonicalizes a framework id without silently ignoring treatment keys.
 * @param raw - base or base[key=value,...]
 * @throws Error for malformed, duplicate, inapplicable or unimplemented variants
 */
export function parseFrameworkVariant(raw: string): { kind: FrameworkKind; variant: FrameworkVariantKeys; id: string } {
  const match = /^(baseline|branch-only|orchestrate)(?:\[([^\[\]]*)\])?$/.exec(raw.trim());
  if (!match) throw new Error(`Invalid framework variant: ${raw}`);
  const kind = match[1] as FrameworkKind;
  const variant: FrameworkVariantKeys = {};
  const pairs = new Map<string, string>();
  const content = match[2]?.trim();
  for (const rawPart of content ? content.split(",") : []) {
    const part = rawPart.trim();
    const [key, value, extra] = part.split("=").map((s) => s.trim());
    if (!key || extra !== undefined || pairs.has(key)) throw new Error(`Malformed or duplicate variant key: ${part}`);
    const positiveInt = (): number => {
      if (!value || !/^[1-9][0-9]*$/.test(value) || !Number.isSafeInteger(Number(value))) {
        throw new Error(`${key} must be a positive safe integer`);
      }
      return Number(value);
    };
    if (key === "catalog") variant.catalog = positiveInt();
    else if (key === "toolSearch" && kind === "branch-only" && value === undefined) variant.toolSearch = true;
    else if (key === "rerank" && kind === "orchestrate" && (value === "llm" || value === "none" || value === "classifier")) variant.rerank = value;
    else if (key === "secondary" && kind === "orchestrate") variant.secondary = positiveInt();
    else if (key === "executor" && kind === "orchestrate" && value === "branch") variant.executor = value;
    else if (key === "hotPaths" || (key === "executor" && value === "calls")) {
      throw new Error(`Framework treatment is not implemented: ${part}`);
    } else throw new Error(`Unsupported variant for ${kind}: ${part}`);
    pairs.set(key, value === undefined ? key : `${key}=${value}`);
  }
  const suffix = [...pairs.keys()].sort().map((key) => pairs.get(key)!).join(",");
  return { kind, variant, id: suffix ? `${kind}[${suffix}]` : kind };
}
