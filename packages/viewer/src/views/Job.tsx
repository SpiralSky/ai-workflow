/**
 * Job view: conversation + artefacts side panel.
 */

import { useState } from "react";
import { useJob } from "../data/store.js";
import { ConversationView } from "../conversation/ConversationView.js";
import { DiffView } from "../artefacts/DiffView.js";
import { CheckLog } from "../artefacts/CheckLog.js";

interface Props {
  runId: string;
  jobName: string;
  onBack: () => void;
}

type ArtifactTab = "diff" | "check";

export function Job({ runId, jobName, onBack }: Props) {
  const { status, data, error } = useJob(runId, jobName);
  const [artifactTab, setArtifactTab] = useState<ArtifactTab>("diff");

  if (status === "idle" || status === "loading") {
    return <div style={{ padding: 24, color: "var(--fg3)" }}>Loading job…</div>;
  }
  if (status === "error" || !data) {
    return <div style={{ padding: 24, color: "var(--fail)" }}>Error loading job: {error}</div>;
  }

  const outcomeColor = data.outcome === "pass" ? "var(--pass)" : "var(--fail)";

  return (
    <div style={{ display: "flex", flexDirection: "column", height: "100%", overflow: "hidden" }}>
      {/* Header */}
      <div
        style={{
          padding: "10px 16px",
          borderBottom: "1px solid var(--border)",
          background: "var(--bg2)",
          display: "flex",
          alignItems: "center",
          gap: 12,
          flexShrink: 0,
        }}
      >
        <button
          onClick={onBack}
          style={{ color: "var(--accent)", fontSize: 13, padding: "2px 4px" }}
        >
          ← Back
        </button>
        <span style={{ fontFamily: "var(--font-mono)", fontSize: 13 }}>{jobName}</span>
        <span style={{ color: outcomeColor, fontWeight: 700, fontSize: 13 }}>
          {data.outcome.toUpperCase()}
          {data.reason ? ` (${data.reason})` : ""}
        </span>
        <span style={{ color: "var(--fg3)", fontSize: 12, marginLeft: "auto" }}>
          {data.costUsdAllAttempts == null ? "unknown" : "$" + data.costUsdAllAttempts.toFixed(4)} · {Math.round(data.durationMs / 1000)}s
        </span>
      </div>

      {/* Content: conversation + side panel */}
      <div style={{ display: "flex", flex: 1, overflow: "hidden" }}>
        {/* Conversation */}
        <div style={{ flex: 1, overflow: "auto", padding: "0 16px" }}>
          <ConversationView events={data.events} />
        </div>

        {/* Artefacts side panel */}
        <div
          style={{
            width: 420,
            borderLeft: "1px solid var(--border)",
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            flexShrink: 0,
          }}
        >
          {/* Tab bar */}
          <div
            style={{
              display: "flex",
              borderBottom: "1px solid var(--border)",
              background: "var(--bg2)",
              flexShrink: 0,
            }}
          >
            {(["diff", "check"] as ArtifactTab[]).map((tab) => (
              <button
                key={tab}
                onClick={() => setArtifactTab(tab)}
                style={{
                  padding: "8px 16px",
                  fontSize: 12,
                  fontWeight: artifactTab === tab ? 700 : 400,
                  color: artifactTab === tab ? "var(--accent)" : "var(--fg2)",
                  borderBottom: artifactTab === tab ? `2px solid var(--accent)` : "2px solid transparent",
                }}
              >
                {tab === "diff" ? "Diff" : "Check log"}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div style={{ flex: 1, overflow: "auto", padding: 12 }}>
            {artifactTab === "diff" && <DiffView patch={data.diff} />}
            {artifactTab === "check" && <CheckLog log={data.checkLog} />}
          </div>
        </div>
      </div>
    </div>
  );
}
