/**
 * Summary view: pass rate, cost, turn/tool rollup per framework.
 */

import type { RunEntry, JobSummary } from "../types.js";

interface Props {
  run: RunEntry;
  framework: string;
}

function fmtCost(usd: number): string {
  return `$${usd.toFixed(4)}`;
}

function fmtPct(n: number, d: number): string {
  if (d === 0) return "—";
  return `${Math.round((n / d) * 100)}%`;
}

export function Summary({ run, framework }: Props) {
  const jobs = run.jobs.filter((j) => j.framework === framework);
  const passed = jobs.filter((j) => j.outcome === "pass").length;
  const failed = jobs.filter((j) => j.outcome === "fail").length;
  const total = jobs.length;
  const totalCost = jobs.reduce((s, j) => s + j.costUsdAllAttempts, 0);

  // Failure reasons breakdown
  const reasons = new Map<string, number>();
  for (const j of jobs) {
    if (j.outcome === "fail" && j.reason) {
      reasons.set(j.reason, (reasons.get(j.reason) ?? 0) + 1);
    }
  }

  const rows: [string, string, string][] = [
    ["Pass rate", `${passed} / ${total}`, fmtPct(passed, total)],
    ["Total cost", fmtCost(totalCost), total > 0 ? `${fmtCost(totalCost / total)} / job` : "—"],
  ];

  return (
    <div style={{ padding: 20, maxWidth: 640 }}>
      <h2 style={{ marginBottom: 16, fontSize: 16, fontWeight: 700 }}>{framework}</h2>

      <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20 }}>
        <tbody>
          {rows.map(([label, value, sub]) => (
            <tr key={label} style={{ borderBottom: "1px solid var(--border)" }}>
              <td style={{ padding: "8px 4px", color: "var(--fg2)", width: 160 }}>{label}</td>
              <td style={{ padding: "8px 4px", fontWeight: 600 }}>{value}</td>
              <td style={{ padding: "8px 4px", color: "var(--fg3)", fontSize: 12 }}>{sub}</td>
            </tr>
          ))}
        </tbody>
      </table>

      {reasons.size > 0 && (
        <>
          <h3 style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, color: "var(--fg2)" }}>
            Failure breakdown
          </h3>
          <table style={{ width: "100%", borderCollapse: "collapse", marginBottom: 20 }}>
            <tbody>
              {Array.from(reasons.entries()).sort((a, b) => b[1] - a[1]).map(([reason, count]) => (
                <tr key={reason} style={{ borderBottom: "1px solid var(--border)" }}>
                  <td style={{ padding: "6px 4px", fontFamily: "var(--font-mono)", fontSize: 12 }}>{reason}</td>
                  <td style={{ padding: "6px 4px", color: "var(--fail)", fontWeight: 600 }}>{count}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}

      {total === 0 && (
        <div style={{ color: "var(--fg3)" }}>No jobs for this framework.</div>
      )}
    </div>
  );
}
