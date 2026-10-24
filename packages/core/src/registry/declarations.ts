import type { JSONSchema, ToolDecl } from "./types.ts";

/** Keywords the converter cannot express; a schema using one degrades to `unknown`. */
const UNSUPPORTED = ["$ref", "allOf", "not", "patternProperties", "if", "then", "else", "dependentSchemas", "prefixItems"];

/** True when `t` has a `|` outside brackets, braces, parens and string literals. */
function hasTopLevelUnion(t: string): boolean {
  let depth = 0;
  for (let i = 0; i < t.length; i++) {
    const c = t[i];
    if (c === '"') {
      for (i++; i < t.length && t[i] !== '"'; i++) if (t[i] === "\\") i++;
    } else if ("{([<".includes(c)) depth++;
    else if ("})]>".includes(c)) depth--;
    else if (c === "|" && depth === 0) return true;
  }
  return false;
}

/** Renders `text` as a JSDoc block (single line when possible) indented by `indent`. */
function jsdoc(text: string, indent: string): string {
  const lines = text.replace(/\*\//g, "*\\/").trim().split("\n");
  if (lines.length === 1) return `${indent}/** ${lines[0]} */\n`;
  return `${indent}/**\n${lines.map((l) => `${indent} * ${l}`.trimEnd()).join("\n")}\n${indent} */\n`;
}

/** Quotes a property name unless it is a plain identifier. */
const propKey = (k: string) => (/^[A-Za-z_$][\w$]*$/.test(k) ? k : JSON.stringify(k));

/**
 * Converts a JSON Schema to TypeScript type text with an in-house converter. Unsupported
 * constructs become `unknown /* unsupported: <keyword> *\/`; it never throws.
 * @param schema - the JSON Schema (any value is tolerated)
 * @param indent - indentation of the line the type starts on, used for multi-line objects
 * @returns TS type text
 */
export function schemaToTS(schema: JSONSchema, indent = ""): string {
  if (!schema || typeof schema !== "object" || Array.isArray(schema)) return "unknown";
  const bad = UNSUPPORTED.find((k) => k in schema);
  if (bad) return `unknown /* unsupported: ${bad} */`;
  if ("const" in schema) return JSON.stringify(schema.const) ?? "unknown";
  if (Array.isArray(schema.enum)) return schema.enum.length ? schema.enum.map((v) => JSON.stringify(v) ?? "unknown").join(" | ") : "never";
  for (const k of ["anyOf", "oneOf"]) {
    const alts = schema[k];
    if (Array.isArray(alts)) return alts.length ? [...new Set(alts.map((s) => schemaToTS(s as JSONSchema, indent)))].join(" | ") : "never";
  }
  let type = schema.type;
  if (Array.isArray(type)) {
    if (!type.length) return "unknown";
    return [...new Set(type.map((t) => schemaToTS({ ...schema, type: t }, indent)))].join(" | ");
  }
  if (type === undefined && (schema.properties || schema.additionalProperties)) type = "object";
  switch (type) {
    case "string": return "string";
    case "number": case "integer": return "number";
    case "boolean": return "boolean";
    case "null": return "null";
    case "array": {
      const item = schemaToTS((schema.items ?? {}) as JSONSchema, indent);
      return (hasTopLevelUnion(item) ? `(${item})` : item) + "[]";
    }
    case "object": return objectToTS(schema, indent);
    default: return "unknown";
  }
}

/** Object branch of {@link schemaToTS}: properties, optionality, JSDoc and index signature. */
function objectToTS(schema: JSONSchema, indent: string): string {
  const props = (schema.properties ?? {}) as Record<string, JSONSchema>;
  const required = new Set(Array.isArray(schema.required) ? (schema.required as string[]) : []);
  const inner = indent + "  ";
  const members: { text: string; doc?: string }[] = Object.entries(props).map(([k, s]) => ({
    text: `${propKey(k)}${required.has(k) ? "" : "?"}: ${schemaToTS(s, inner)};`,
    doc: s && typeof s.description === "string" && s.description.trim() ? s.description : undefined,
  }));
  const ap = schema.additionalProperties;
  if (ap === true) members.push({ text: "[key: string]: unknown;" });
  else if (ap && typeof ap === "object") members.push({ text: `[key: string]: ${schemaToTS(ap as JSONSchema, inner)};` });
  if (!members.length) return "{}";
  if (!members.some((m) => m.doc || m.text.includes("\n")))
    return `{ ${members.map((m) => m.text).join(" ").replace(/;$/, "")} }`;
  const body = members.map((m) => (m.doc ? jsdoc(m.doc, inner) : "") + inner + m.text);
  return `{\n${body.join("\n")}\n${indent}}`;
}

/** Renders one tool's declaration block. */
function declBlock(d: ToolDecl): string {
  const host = d.hostName !== d.name ? `// host: ${d.hostName}\n` : "";
  return `${jsdoc(d.description || d.name, "")}${host}${d.name}(args: ${schemaToTS(d.parameters)}): Promise<${d.returns || "unknown"}>;`;
}

/** The single line replacing declarations dropped by the cap (core-tools-and-hosts §6.2). */
const omittedLine = (names: string[]) =>
  `// ${names.length} more tools not shown: ${names.join(", ")}. Call tools.tools({ names }) for their full declarations.`;

/**
 * Generates the TS declaration block shown to the model, one block per tool in catalog order.
 * @param decls - registered tools in catalog order
 * @param opts - `maxChars` caps the output; `priority` lists tool names to keep first when capped
 * @returns the declarations text; capped output ends with a line naming the omitted tools
 */
export function declarations(decls: ToolDecl[], opts: { maxChars?: number; priority?: string[] } = {}): string {
  const blocks = new Map(decls.map((d) => [d.name, declBlock(d)]));
  const catalog = decls.map((d) => d.name);
  const { maxChars } = opts;
  const render = (keep: Set<string>, omitted: string[]) =>
    [...catalog.filter((n) => keep.has(n)).map((n) => blocks.get(n)!), ...(omitted.length ? [omittedLine(omitted)] : [])].join("\n");
  if (maxChars === undefined || render(new Set(catalog), []).length <= maxChars) return render(new Set(catalog), []);
  const pri = (opts.priority ?? []).filter((n) => blocks.has(n));
  const order = [...new Set([...pri, ...catalog])];
  const keep = new Set<string>();
  const dropped: string[] = [];
  order.forEach((n, i) => {
    // Assume everything undecided later is omitted; accepting only shrinks that line.
    const later = order.slice(i + 1);
    const trial = new Set(keep).add(n);
    const omitted = [...dropped, ...later].sort((a, b) => catalog.indexOf(a) - catalog.indexOf(b));
    if (render(trial, omitted).length <= maxChars) keep.add(n);
    else dropped.push(n);
  });
  const omitted = catalog.filter((n) => !keep.has(n));
  return render(keep, omitted);
}
