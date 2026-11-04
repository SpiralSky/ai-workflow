/** Unsupported native records must never fall through into numeric totals. */
export class UnsupportedNativeFormatError extends Error {
  constructor() { super("Unsupported native format in numeric telemetry or runner"); this.name = "UnsupportedNativeFormatError"; }
}
/** Inspect artifact/config metadata without interpreting arbitrary transcript or tool data. */
export function rejectNativeFormat(value: unknown): void {
  if (!value || typeof value !== "object") return;
  const record = value as Record<string, unknown>;
  if (record.usage === null || record.usageStatus === "unavailable" || record.usageReason === "native-harness-unreported" ||
      record.completionEvidence !== undefined || record.nativeMode !== undefined ||
      Object.hasOwn(record, "nativeCompletion") || Object.hasOwn(record, "completionLane") ||
      [record.version, record.format, record.schema, record.kind, record.provider, record.usageMode].some(v => typeof v === "string" && (v === "native" || v.startsWith("native-")))) {
    throw new UnsupportedNativeFormatError();
  }
  if (record.kind === "final-submission") rejectNativeFormat(record.submission);
  for (const key of ["config", "inference", "provenance", "event"]) if (record[key]) rejectNativeFormat(record[key]);
  for (const key of ["events", "runs", "jobs", "attempts"]) {
    const children = record[key];
    if (Array.isArray(children)) children.forEach(rejectNativeFormat);
  }
}

