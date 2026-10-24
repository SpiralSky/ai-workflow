import { isDeepStrictEqual } from "node:util";
import type { Blobs } from "./blobs.ts";
import type { TranscriptEntry } from "./schema.ts";
import type { Sink } from "./sink.ts";

/** Writes per-request transcript entries as deltas over each session's previous request. */
export class TranscriptWriter {
  private readonly sessions = new Map<string, { seq: number; prev: unknown[] }>();
  private readonly sink: Sink;
  private readonly blobs: Blobs;
  constructor(opts: { sink: Sink; blobs: Blobs }) {
    this.sink = opts.sink;
    this.blobs = opts.blobs;
  }

  /**
   * Records one request/response. `append` holds the messages added since the session's previous
   * request; if history was rewritten (previous array is not a prefix), the full array is written
   * with `reset: true`.
   */
  record(e: {
    turnId: string;
    session: string;
    system: string;
    tools: unknown[];
    messages: unknown[];
    response: unknown;
  }): void {
    const st = this.sessions.get(e.session) ?? { seq: 0, prev: [] };
    const isPrefix =
      st.prev.length <= e.messages.length && st.prev.every((m, i) => isDeepStrictEqual(m, e.messages[i]));
    const entry: TranscriptEntry = {
      v: 1,
      turnId: e.turnId,
      session: e.session,
      seq: st.seq + 1,
      system: this.blobs.put(e.system),
      tools: this.blobs.putJson(e.tools),
      append: isPrefix ? e.messages.slice(st.prev.length) : e.messages,
      response: e.response,
      ...(isPrefix ? {} : { reset: true as const }),
    };
    // Snapshot: callers may keep mutating their array.
    this.sessions.set(e.session, { seq: entry.seq, prev: structuredClone(e.messages) });
    this.sink.write(entry);
  }
}

/**
 * Rebuilds the full message array of every request in a session.
 * @param entries - transcript entries (any order)
 * @param session - session name
 * @returns one array per entry, in `seq` order
 */
export function reconstruct(entries: TranscriptEntry[], session: string): unknown[][] {
  const out: unknown[][] = [];
  let cur: unknown[] = [];
  for (const e of entries.filter((x) => x.session === session).sort((a, b) => a.seq - b.seq)) {
    cur = e.reset ? [...e.append] : [...cur, ...e.append];
    out.push(cur);
  }
  return out;
}
