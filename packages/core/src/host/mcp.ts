interface MCPContent {
  type: string;
  text?: string;
  [k: string]: unknown;
}

/** An MCP `tools/call` result as far as the tool layer cares. */
export interface MCPResult {
  content?: MCPContent[];
  structuredContent?: unknown;
  isError?: boolean;
}

/** Single text item: parsed only when the JSON is an object/array; scalars stay text on purpose. */
function fromItem(item: MCPContent): unknown {
  if (item.type !== "text" || typeof item.text !== "string") return item;
  try {
    const v: unknown = JSON.parse(item.text);
    if (v !== null && typeof v === "object") return v;
  } catch {
    // not JSON: keep the raw text
  }
  return item.text;
}

/**
 * Converts an MCP tool result to a tool return value (core-tools-and-hosts §3).
 * @param res - the MCP result
 * @returns structuredContent if present; else the (parsed) single text item; else an array of items; else null
 * @throws Error with the joined text items when `isError` is set
 */
export function fromMCPResult(res: MCPResult): unknown {
  const items = res.content ?? [];
  if (res.isError) throw new Error(items.filter((c) => c.type === "text").map((c) => c.text ?? "").join("\n"));
  if (res.structuredContent !== undefined && res.structuredContent !== null) return res.structuredContent;
  if (items.length === 0) return null;
  if (items.length === 1) return fromItem(items[0]!);
  return items.map(fromItem);
}
