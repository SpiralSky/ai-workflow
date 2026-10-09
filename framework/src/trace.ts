// JSONL trace: full data lives here, never in the model's context.
import { appendFileSync } from "node:fs";
import type { Session } from "./helpers.js";

export function trace(s: Session, ev: Record<string, unknown>) {
  if (!s.traceFile) return;
  try {
    appendFileSync(s.traceFile, JSON.stringify({ t: new Date().toISOString(), ...ev }) + "\n");
  } catch { /* tracing must never break a branch */ }
}
