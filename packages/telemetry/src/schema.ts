import { z } from "zod";

/** Token usage of one model request. Optional fields are omitted when the API did not report them. */
export const UsageSchema = z.object({
  input: z.number(),
  output: z.number(),
  cachedRead: z.number().optional(),
  cacheWrite: z.number().optional(),
});
export type Usage = z.infer<typeof UsageSchema>;

/** Where a turn's dollar cost came from (framework-runner §4.1). */
export const CostSourceSchema = z.enum(["api", "price-table", "api-equivalent"]);
export type CostSource = z.infer<typeof CostSourceSchema>;

export const RoleSchema = z.enum(["main", "secondary", "selection"]);
export type Role = z.infer<typeof RoleSchema>;

const common = {
  v: z.literal(1),
  id: z.string(),
  parent: z.string().nullable(),
  ts: z.number(),
};

export const EventSchema = z.discriminatedUnion("kind", [
  z.object({
    ...common,
    kind: z.literal("job"),
    job: z.string(),
    attempt: z.number(),
    framework: z.string(),
    problem: z.string(),
    rep: z.number(),
  }),
  z.object({ ...common, kind: z.literal("scope"), label: z.string() }),
  z.object({
    ...common,
    kind: z.literal("turn"),
    model: z.string(), // Requested identifier, possibly an alias.
    providerModel: z.string().optional(),
    providerSystemFingerprint: z.string().optional(),
    role: RoleSchema,
    usage: UsageSchema.optional(),
    costUsd: z.number().optional(),
    costSource: CostSourceSchema.optional(),
    priceTable: z.string().optional(), // Price-table version, only for price-table costs.
    cacheHit: z.boolean().optional(),
    latencyMs: z.number(),
  }),
  z.object({
    ...common,
    kind: z.literal("toolStart"),
    name: z.string(),
    args: z.unknown(),
    harnessId: z.string().optional(),
  }),
  z.object({
    ...common,
    kind: z.literal("tool"),
    name: z.string(),
    args: z.unknown(),
    ok: z.boolean(),
    error: z.string().optional(),
    durationMs: z.number(),
    startTs: z.number(),
    harnessId: z.string().optional(),
    resultBytes: z.number(),
  }),
  z.object({
    ...common,
    kind: z.literal("attach"),
    key: z.string(),
    data: z.unknown().optional(),
    blob: z.string().optional(),
  }),
  z.object({
    ...common,
    kind: z.literal("end"),
    outcome: z.string(),
    reason: z.string().optional(),
  }),
]);
export type EventRecord = z.infer<typeof EventSchema>;
export type EventOf<K extends EventRecord["kind"]> = Extract<EventRecord, { kind: K }>;

export const TranscriptEntrySchema = z.object({
  v: z.literal(1),
  turnId: z.string(),
  session: z.string(),
  seq: z.number(),
  system: z.string(),
  tools: z.string(),
  append: z.array(z.unknown()),
  response: z.unknown(),
  reset: z.literal(true).optional(),
});
export type TranscriptEntry = z.infer<typeof TranscriptEntrySchema>;

export interface ParseResult {
  events: EventRecord[];
  /** Lines that were complete but invalid (1-based line numbers). */
  errors: { line: number; message: string }[];
  /** True when the final line was cut off mid-write (crash) and was dropped. */
  truncatedTail: boolean;
}

/**
 * Parses an `events.jsonl` text. Invalid complete lines are reported in `errors`; an unparseable
 * final line without a trailing newline is treated as a crash-truncated write and dropped
 * (reported via `truncatedTail`, not as an error).
 * @param text - raw file contents
 */
export function parseEvents(text: string): ParseResult {
  const events: EventRecord[] = [];
  const errors: ParseResult["errors"] = [];
  let truncatedTail = false;
  const lines = text.split("\n");
  const endsWithNewline = text.endsWith("\n");
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!;
    if (raw.trim() === "") continue;
    const isLast = i === lines.length - 1;
    let json: unknown;
    try {
      json = JSON.parse(raw);
    } catch (e) {
      if (isLast && !endsWithNewline) truncatedTail = true;
      else errors.push({ line: i + 1, message: (e as Error).message });
      continue;
    }
    const r = EventSchema.safeParse(json);
    if (r.success) events.push(r.data);
    else errors.push({ line: i + 1, message: r.error.message });
  }
  return { events, errors, truncatedTail };
}
