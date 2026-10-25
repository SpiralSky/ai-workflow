/**
 * Left sidebar listing run groups, newest-first.
 */

import type { RunEntry } from "../types.js";

interface Props {
  runs: RunEntry[];
  selectedRunId: string | null;
  onSelect: (runId: string) => void;
}

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toISOString().slice(0, 16).replace("T", " ");
}

function fmtStatus(status: string | Record<string, unknown>): { text: string; color: string } {
  if (typeof status === "string") {
    if (status === "complete") return { text: "complete", color: "var(--pass)" };
    if (status === "in-progress") return { text: "in progress", color: "var(--warn)" };
    return { text: status, color: "var(--fg3)" };
  }
  const key = Object.keys(status)[0];
  return { text: key ?? "invalid", color: "var(--fail)" };
}

export function Sidebar({ runs, selectedRunId, onSelect }: Props) {
  const sorted = [...runs].sort(
    (a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime()
  );

  return (
    <div
      style={{
        width: 240,
        borderRight: "1px solid var(--border)",
        overflow: "auto",
        background: "var(--bg2)",
        flexShrink: 0,
      }}
    >
      <div
        style={{
          padding: "10px 12px",
          fontWeight: 700,
          fontSize: 12,
          color: "var(--fg3)",
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          borderBottom: "1px solid var(--border)",
        }}
      >
        Runs
      </div>

      {sorted.length === 0 && (
        <div style={{ padding: 16, color: "var(--fg3)", fontSize: 12 }}>No runs indexed.</div>
      )}

      {sorted.map((run) => {
        const selected = run.id === selectedRunId;
        const { text: statusText, color: statusColor } = fmtStatus(run.status as string);
        const passRate =
          run.totals.jobs > 0
            ? Math.round((run.totals.pass / run.totals.jobs) * 100)
            : null;

        return (
          <button
            key={run.id}
            onClick={() => onSelect(run.id)}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "10px 12px",
              borderBottom: "1px solid var(--border)",
              background: selected ? "rgba(14,165,233,0.08)" : "transparent",
              borderLeft: selected ? "3px solid var(--accent)" : "3px solid transparent",
              color: "inherit",
            }}
          >
            <div style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--fg2)", marginBottom: 2 }}>
              {fmtDate(run.startedAt)}
            </div>
            <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 3 }}>
              {run.id.slice(0, 20)}
            </div>
            <div style={{ fontSize: 11, color: "var(--fg3)", marginBottom: 3 }}>
              {run.frameworks.join(", ")}
            </div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 11 }}>
              <span style={{ color: statusColor }}>{statusText}</span>
              {passRate != null && (
                <span style={{ color: passRate === 100 ? "var(--pass)" : passRate === 0 ? "var(--fail)" : "var(--warn)" }}>
                  {passRate}%
                </span>
              )}
              <span style={{ color: "var(--fg3)", marginLeft: "auto" }}>
                ${run.totals.costUsd.toFixed(3)}
              </span>
            </div>
          </button>
        );
      })}
    </div>
  );
}
