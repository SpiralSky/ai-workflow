/**
 * Renders a unified diff patch with per-line colouring.
 */

interface Props {
  patch: string;
}

interface DiffLine {
  kind: "header" | "hunk" | "add" | "del" | "ctx" | "meta";
  text: string;
}

/** Parse a unified diff string into typed lines. */
function parseDiff(patch: string): DiffLine[] {
  return patch.split("\n").map((line): DiffLine => {
    if (line.startsWith("diff ") || line.startsWith("index ") || line.startsWith("--- ") || line.startsWith("+++ ")) {
      return { kind: "header", text: line };
    }
    if (line.startsWith("@@")) return { kind: "hunk", text: line };
    if (line.startsWith("+")) return { kind: "add", text: line };
    if (line.startsWith("-")) return { kind: "del", text: line };
    return { kind: "ctx", text: line };
  });
}

const lineColors: Record<DiffLine["kind"], string | undefined> = {
  header: "var(--fg3)",
  hunk: "var(--accent)",
  add: "var(--pass)",
  del: "var(--fail)",
  ctx: undefined,
  meta: "var(--fg3)",
};

const lineBg: Record<DiffLine["kind"], string | undefined> = {
  header: undefined,
  hunk: undefined,
  add: "rgba(22,163,74,0.08)",
  del: "rgba(220,38,38,0.08)",
  ctx: undefined,
  meta: undefined,
};

export function DiffView({ patch }: Props) {
  if (!patch.trim()) {
    return <div style={{ color: "var(--fg3)", padding: 12 }}>No diff available.</div>;
  }

  const lines = parseDiff(patch);

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
        padding: "8px 0",
      }}
    >
      {lines.map((line, i) => (
        <div
          key={i}
          style={{
            padding: "0 12px",
            whiteSpace: "pre",
            color: lineColors[line.kind] ?? "var(--fg)",
            background: lineBg[line.kind],
          }}
        >
          {line.text || " "}
        </div>
      ))}
    </div>
  );
}
