// Tool entry interface for the hierarchical orchestration catalog.
// Entries follow the MCP / Anthropic API tool definition format so the catalog
// is portable across execution harnesses (branch helpers, MCP tools, built-ins).

export type JSONSchema = {
  type: "object";
  properties: Record<string, { type: string; description?: string; [k: string]: unknown }>;
  required?: string[];
  [k: string]: unknown;
};

export type ExecutionKind = "helper" | "mcp" | "builtin" | "composite";

export interface ToolEntry {
  // Identity
  id: string;
  name: string;

  // Standard tool protocol (MCP/Anthropic API format)
  toolDef: {
    name: string;
    description: string;
    inputSchema: JSONSchema;
  };

  // Retrieval
  searchDescription: string;      // may be richer than toolDef.description
  useCaseSummary?: string;        // LLM-generated use-case vocabulary for BM25
  tags: string[];

  // Execution
  executionKind: ExecutionKind;
  tsDeclaration?: string;         // TypeScript declaration injected into filtered helpers.d.ts

  // Composite shortcuts only
  composite?: {
    declaration: string;          // `declare function ...` line for filtered helpers.d.ts
    implementation: string;       // async TS function body, prepended before the secondary LLM's branch
    dependencies?: string[];      // primitive helper IDs this composite calls (added to allowed set)
  };
}
