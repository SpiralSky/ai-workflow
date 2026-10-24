/** Drops characters that cannot appear in a JS identifier. */
const dropInvalid = (s: string) => s.replace(/[^A-Za-z0-9_$]/g, "");

/** Camel-cases `_`/`-`/space separated words, lowercasing only the first char of the result. */
function camel(s: string): string {
  const words = s.split(/[_\-\s]+/).filter(Boolean);
  const joined = words.map((w, i) => (i ? w[0]!.toUpperCase() + w.slice(1) : w)).join("");
  return dropInvalid(joined).replace(/^./, (c) => c.toLowerCase());
}

/**
 * Maps a host tool name to a valid JS identifier (core-tools-and-hosts §3).
 * `mcp__<server>__<tool_name>` → `<server>_<toolName>` (server keeps its identifier chars, tool
 * part camel-cased); other names are camel-cased (`read_file`/`read-file` → `readFile`) with only
 * the first character lowercased (`Bash` → `bash`, `WebFetch` → `webFetch`; already-camel names
 * unchanged). Non-identifier characters are dropped; a leading digit gets a `_` prefix.
 * @param hostName - the name the host knows
 * @returns the normalised identifier (`_` if nothing usable remains)
 */
export function normalizeName(hostName: string): string {
  const m = /^mcp__(.+?)__(.+)$/.exec(hostName);
  let name = m ? `${dropInvalid(m[1]!)}_${camel(m[2]!)}` : camel(hostName);
  if (!name) name = "_";
  return /^[0-9]/.test(name) ? "_" + name : name;
}
