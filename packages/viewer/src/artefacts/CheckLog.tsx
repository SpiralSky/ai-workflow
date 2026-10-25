/**
 * Renders check.log with failing test lines highlighted.
 */

interface Props {
  log: string;
}

/** Classify a check log line for display. */
function classifyLine(line: string): "fail" | "pass" | "header" | "plain" {
  if (/^FAIL(ED)?[\s:]/.test(line) || /^ERROR[\s:]/.test(line)) return "fail";
  if (/^ok\s/.test(line) || /^(Ran \d|OK$|OK \()/.test(line)) return "pass";
  if (/^[-=]{3,}/.test(line)) return "header";
  return "plain";
}

export function CheckLog({ log }: Props) {
  if (!log.trim()) {
    return <div style={{ color: "var(--fg3)", padding: 12 }}>No check log available.</div>;
  }

  const lines = log.split("\n");

  return (
    <div
      style={{
        fontFamily: "var(--font-mono)",
        fontSize: 12,
        lineHeight: 1.5,
        overflow: "auto",
        background: "var(--bg2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        padding: "8px 12px",
      }}
    >
      {lines.map((line, i) => {
        const kind = classifyLine(line);
        const color =
          kind === "fail" ? "var(--fail)" :
          kind === "pass" ? "var(--pass)" :
          kind === "header" ? "var(--fg3)" :
          "var(--fg)";
        return (
          <div
            key={i}
            style={{
              whiteSpace: "pre-wrap",
              wordBreak: "break-all",
              color,
              background: kind === "fail" ? "rgba(220,38,38,0.06)" : undefined,
              padding: kind === "fail" ? "0 4px" : undefined,
              borderRadius: kind === "fail" ? 3 : undefined,
            }}
          >
            {line || " "}
          </div>
        );
      })}
    </div>
  );
}
