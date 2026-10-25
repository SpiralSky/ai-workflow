/**
 * Renders a tool call (toolStart + tool events) as an expandable card.
 */

import { useState } from "react";
import type { RawEvent } from "../types.js";

interface Props {
  startEvent: RawEvent;
  endEvent: RawEvent | null;
}

/** Compact one-line summary of tool args. */
function compactArgs(args: unknown): string {
  if (!args || typeof args !== "object") return String(args ?? "");
  const entries = Object.entries(args as Record<string, unknown>);
  if (entries.length === 0) return "{}";
  const parts = entries.slice(0, 3).map(([k, v]) => {
    const val = typeof v === "string" ? (v.length > 40 ? v.slice(0, 40) + "…" : v) : JSON.stringify(v);
    return `${k}: ${val}`;
  });
  return parts.join(", ") + (entries.length > 3 ? ", …" : "");
}

export function ToolCallCard({ startEvent, endEvent }: Props) {
  const [expanded, setExpanded] = useState(false);
  const name = startEvent.name as string;
  const args = startEvent.args as Record<string, unknown> | null;
  const ok = endEvent ? (endEvent.ok as boolean) : null;
  const durationMs = endEvent ? (endEvent.durationMs as number) : null;

  // Extract result text from the end event
  const resultText = endEvent && typeof endEvent.result === "string"
    ? endEvent.result
    : endEvent?.result != null
    ? JSON.stringify(endEvent.result, null, 2)
    : null;

  return (
    <div
      style={{
        border: `1px solid var(--border)`,
        borderLeft: `3px solid var(--tool)`,
        borderRadius: "var(--radius)",
        marginBottom: 8,
        background: "var(--bg2)",
        overflow: "hidden",
      }}
    >
      <button
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "6px 10px",
          textAlign: "left",
          color: "var(--tool)",
          fontFamily: "var(--font-mono)",
          fontSize: 12,
        }}
        onClick={() => setExpanded((e) => !e)}
      >
        <span style={{ fontSize: 10, color: "var(--fg3)" }}>{expanded ? "▼" : "▶"}</span>
        <span style={{ fontWeight: 600 }}>{name}</span>
        <span style={{ color: "var(--fg3)", flex: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          {compactArgs(args)}
        </span>
        {ok !== null && (
          <span style={{ color: ok ? "var(--pass)" : "var(--fail)", fontSize: 11 }}>
            {ok ? "✓" : "✗"}
          </span>
        )}
        {durationMs != null && (
          <span style={{ color: "var(--fg3)", fontSize: 11 }}>{durationMs}ms</span>
        )}
      </button>

      {expanded && (
        <div style={{ padding: "8px 12px", borderTop: "1px solid var(--border)" }}>
          <div style={{ marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: "var(--fg3)", fontWeight: 600, textTransform: "uppercase" }}>
              Args
            </span>
            <pre
              style={{
                fontFamily: "var(--font-mono)",
                fontSize: 11,
                marginTop: 4,
                padding: 8,
                background: "var(--bg3)",
                borderRadius: 4,
                overflow: "auto",
                maxHeight: 300,
                whiteSpace: "pre-wrap",
                wordBreak: "break-all",
              }}
            >
              {JSON.stringify(args, null, 2)}
            </pre>
          </div>

          {endEvent && (
            <div>
              <span
                style={{
                  fontSize: 11,
                  color: ok ? "var(--result)" : "var(--fail)",
                  fontWeight: 600,
                  textTransform: "uppercase",
                }}
              >
                Result {ok ? "" : "(error)"}
              </span>
              <pre
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: 11,
                  marginTop: 4,
                  padding: 8,
                  background: "var(--bg3)",
                  borderRadius: 4,
                  overflow: "auto",
                  maxHeight: 400,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-all",
                  color: ok ? undefined : "var(--fail)",
                }}
              >
                {resultText ?? "(no result)"}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
