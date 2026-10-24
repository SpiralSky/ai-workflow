/** A JSON Schema object (the subset tools use; see core-tools-and-hosts §6.1). */
export type JSONSchema = Record<string, unknown>;

/** Orchestrate §6 effect: only `read` counts as read-only. */
export type Effect = "read" | "exec" | "write" | "external";

/** Orchestrate §6 selection metadata, with defaults applied (core-tools-and-hosts §2). */
export interface SelectionMeta {
  whenToUse: string;
  whenNotToUse?: string;
  examples?: string[];
  category?: string;
  effect: Effect;
  requires?: string[];
  cost?: number;
}

/** A tool as a host lists it, before normalisation and defaults. */
export interface HostToolDecl {
  /** The name the host knows (e.g. `mcp__github__create_issue`). */
  name: string;
  description: string;
  /** JSON Schema of the single argument object. */
  inputSchema: JSONSchema;
  /** TS type text of the result. */
  returns?: string;
  /** Default `routed` (harness-integration §4.2). */
  routing?: "routed" | "direct";
  /** The host enforces the output cap itself, so `capOutput` skips it (core-tools-and-hosts §5). */
  capsOutput?: boolean;
  meta?: Partial<SelectionMeta>;
}

/** A registered tool (core-tools-and-hosts §2). */
export interface ToolDecl {
  /** Valid JS identifier (normalised, §3). */
  name: string;
  hostName: string;
  description: string;
  parameters: JSONSchema;
  /** TS type text, `unknown` if omitted. */
  returns: string;
  routing: "routed" | "direct";
  capsOutput: boolean;
  meta: SelectionMeta;
}

/** Registered tools in catalog (host listing) order. */
export interface Registry {
  decls: ToolDecl[];
  byName: Map<string, ToolDecl>;
  byHostName: Map<string, ToolDecl>;
}
