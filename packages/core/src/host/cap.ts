/** Default output cap in bytes (core-tools-and-hosts §5). */
export const DEFAULT_OUTPUT_CAP = 8192;

/**
 * Caps a tool result. Under the cap the value is returned unchanged; over it the result becomes a
 * string (so an over-cap structured result turns into truncated JSON text): a UTF-8 safe prefix plus
 * a note, with the total at most `maxBytes`.
 * @param value - the tool result
 * @param maxBytes - cap in bytes of the serialised result
 */
export function capOutput(value: unknown, maxBytes: number = DEFAULT_OUTPUT_CAP): unknown {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  if (text === undefined) return value;
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return value;
  const note = (n: number) => `\n[truncated: showed ${n} of ${buf.length} bytes; request less, e.g. a narrower query, range or offset]`;
  let n = Math.max(0, maxBytes - Buffer.byteLength(note(maxBytes)));
  // the note's digit count depends on n: shrink until the total fits
  while (n > 0 && n + Buffer.byteLength(note(n)) > maxBytes) n--;
  while (n > 0 && (buf[n]! & 0xc0) === 0x80) n--; // don't split a multibyte character
  return buf.subarray(0, n).toString("utf8") + note(n);
}
