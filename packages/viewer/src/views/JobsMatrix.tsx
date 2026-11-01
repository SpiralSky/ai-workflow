/**
 * Jobs matrix view: problems × reps grid, coloured by outcome.
 */

import type { RunEntry, JobSummary } from "../types.js";

interface Props {
  run: RunEntry;
  framework: string;
  onJobClick: (jobName: string) => void;
}

export function JobsMatrix({ run, framework, onJobClick }: Props) {
  const jobs = run.jobs.filter((j) => j.framework === framework);

  if (jobs.length === 0) {
    return <div style={{ padding: 20, color: "var(--fg3)" }}>No jobs for this framework.</div>;
  }

  // Group by problem, collect reps
  const byProblem = new Map<string, JobSummary[]>();
  for (const j of jobs) {
    const list = byProblem.get(j.problem) ?? [];
    list.push(j);
    byProblem.set(j.problem, list);
  }

  const maxReps = Math.max(...jobs.map((j) => j.rep + 1));

  return (
    <div style={{ padding: 20, overflow: "auto" }}>
      <table style={{ borderCollapse: "collapse", fontSize: 13 }}>
        <thead>
          <tr>
            <th style={{ padding: "6px 12px", textAlign: "left", color: "var(--fg2)", fontWeight: 600, borderBottom: "2px solid var(--border)" }}>
              Problem
            </th>
            {Array.from({ length: maxReps }, (_, i) => (
              <th key={i} style={{ padding: "6px 12px", color: "var(--fg2)", fontWeight: 600, borderBottom: "2px solid var(--border)" }}>
                Rep {i}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {Array.from(byProblem.entries()).sort(([a], [b]) => a.localeCompare(b)).map(([problem, jobList]) => (
            <tr key={problem} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "8px 12px", fontFamily: "var(--font-mono)", fontSize: 12 }}>
                {problem}
              </td>
              {Array.from({ length: maxReps }, (_, rep) => {
                const job = jobList.find((j) => j.rep === rep);
                if (!job) return <td key={rep} style={{ padding: "8px 12px", color: "var(--fg3)" }}>—</td>;
                const bg = job.outcome === "pass" ? "rgba(22,163,74,0.12)" : "rgba(220,38,38,0.12)";
                const fg = job.outcome === "pass" ? "var(--pass)" : "var(--fail)";
                return (
                  <td key={rep} style={{ padding: "6px 12px" }}>
                    <button
                      title={`${job.costUsdAllAttempts == null ? "unknown" : "$" + job.costUsdAllAttempts.toFixed(4)} — ${job.reason ?? job.outcome}`}
                      onClick={() => onJobClick(job.name)}
                      style={{
                        background: bg,
                        color: fg,
                        border: `1px solid ${fg}`,
                        borderRadius: 4,
                        padding: "3px 10px",
                        fontSize: 12,
                        fontWeight: 600,
                        cursor: "pointer",
                      }}
                    >
                      {job.outcome === "pass" ? "✓" : "✗"}
                    </button>
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
