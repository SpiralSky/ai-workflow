/**
 * Framework selector tabs for the selected run group.
 */

import type { RunEntry, JobSummary } from "../types.js";

interface Props {
  run: RunEntry;
  selectedFramework: string | null;
  onSelect: (framework: string) => void;
}

function passRate(jobs: JobSummary[]): string {
  if (jobs.length === 0) return "";
  const pct = Math.round((jobs.filter((j) => j.outcome === "pass").length / jobs.length) * 100);
  return `${pct}%`;
}

function meanCost(jobs: JobSummary[]): string {
  if (jobs.length === 0) return "";
  const mean = jobs.reduce((s, j) => s + j.costUsdAllAttempts, 0) / jobs.length;
  return `$${mean.toFixed(4)}`;
}

export function FrameworkTabs({ run, selectedFramework, onSelect }: Props) {
  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        padding: "8px 16px",
        borderBottom: "1px solid var(--border)",
        background: "var(--bg2)",
        flexShrink: 0,
        flexWrap: "wrap",
        alignItems: "center",
      }}
    >
      {run.frameworks.map((fw) => {
        const jobs = run.jobs.filter((j) => j.framework === fw);
        const selected = fw === selectedFramework;
        return (
          <button
            key={fw}
            onClick={() => onSelect(fw)}
            style={{
              padding: "5px 14px",
              borderRadius: 4,
              border: selected ? "1px solid var(--accent)" : "1px solid var(--border)",
              background: selected ? "rgba(14,165,233,0.1)" : "transparent",
              color: selected ? "var(--accent)" : "var(--fg2)",
              fontWeight: selected ? 700 : 400,
              fontSize: 13,
              display: "flex",
              flexDirection: "column",
              alignItems: "flex-start",
              gap: 1,
            }}
          >
            <span>{fw}</span>
            {jobs.length > 0 && (
              <span style={{ fontSize: 10, color: selected ? "var(--accent)" : "var(--fg3)", fontWeight: 400 }}>
                {passRate(jobs)} · {meanCost(jobs)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}
