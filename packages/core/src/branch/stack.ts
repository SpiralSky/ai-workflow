/**
 * Source text of `mapStack(stack, lineMap)`: maps a V8 stack string to original program lines
 * (innermost first). Only frames in `branch-code-<n>.js` count; all other frames are dropped.
 * Kept as source text so the same implementation runs inside the isolate (see recorder.ts).
 */
export const STACK_SOURCE = String.raw`function mapStack(stack, lineMap) {
  const out = [];
  if (typeof stack !== "string") return out;
  for (const frame of stack.split("\n")) {
    const m = /branch-code-\d+\.js:(\d+):\d+/.exec(frame);
    if (!m) continue;
    const line = lineMap[Number(m[1]) - 1];
    if (line !== undefined) out.push(line);
  }
  return out;
}`;

/** Host-side `mapStack`: original lines of the `branch-code-<n>.js` frames in `stack`, innermost first. */
export const mapStack = new Function(`return (${STACK_SOURCE})`)() as (stack: unknown, lineMap: number[]) => number[];
