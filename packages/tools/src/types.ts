import type { HostToolDecl, JSONSchema, SelectionMeta } from "@aiw/core";

/** Per-call context handed to every tool. */
export interface ToolCtx {
  /** Absolute workspace root; every path argument resolves inside it. */
  root: string;
  /** Aborted when the call is cancelled; long-running tools must stop and clean up. */
  signal: AbortSignal;
  /** Environment for spawned processes (defaults to `process.env`; secrets are stripped by `toolEnv`). */
  env?: NodeJS.ProcessEnv;
}

/** A catalog tool: registration fields (branching §6.2), selection metadata (orchestrate §6) and the implementation. */
export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema of the single argument object. */
  parameters: JSONSchema;
  /** TS type text of the result. */
  returns?: string;
  /** Fully filled: the catalog has no derived defaults (tool-catalog §2). */
  meta: Required<Omit<SelectionMeta, "whenNotToUse">> & Pick<SelectionMeta, "whenNotToUse">;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fn(args: any, ctx: ToolCtx): Promise<unknown>;
}

/**
 * Converts a catalog tool into the declaration a host lists. The output cap is left to core's
 * `capOutput`, so `capsOutput` is false.
 * @param def - the catalog tool
 */
export function toHostDecl(def: ToolDef): HostToolDecl {
  return {
    name: def.name,
    description: def.description,
    inputSchema: def.parameters,
    returns: def.returns,
    capsOutput: false,
    meta: def.meta,
  };
}

/** Builds a JSON Schema object for a tool's argument object. */
export function objectSchema(properties: Record<string, JSONSchema>, required: string[] = []): JSONSchema {
  return { type: "object", properties, required, additionalProperties: false };
}
