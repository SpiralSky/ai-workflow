/**
 * Renders one assistant turn as a card with metrics strip and tool calls.
 */

import ReactMarkdown from "react-markdown";
import type { RawEvent } from "../types.js";
import { ToolCallCard } from "./ToolCallCard.js";

interface Props {
  turnEvent: RawEvent;
  textEvents: RawEvent[];
  toolStartEvents: RawEvent[];
  toolEndMap: Map<string, RawEvent>;
}

/** Format a cost in USD to a short human-readable string. */
function fmtCost(usd: number): string {
  if (usd < 0.001) return `$${(usd * 1000).toFixed(3)}m`;
  return `$${usd.toFixed(4)}`;
}

/** Format latency to a short string. */
function fmtLatency(ms: number): string {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(1)}s`;
}

export function MessageCard({ turnEvent, textEvents, toolStartEvents, toolEndMap }: Props) {
  const model = turnEvent.model as string;
  const usage = turnEvent.usage as { input: number; output: number; cachedRead: number; cacheWrite: number } | null;
  const costUsd = turnEvent.costUsd as number | null;
  const latencyMs = turnEvent.latencyMs as number | null;
  const role = turnEvent.role as string | null;

  const textContent = textEvents.map((e) => e.content as string).join("\n\n");

  return (
    <div
      style={{
        background: "var(--bg2)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius)",
        marginBottom: 12,
        overflow: "hidden",
      }}
    >
      {/* Metrics strip */}
      <div
        style={{
          display: "flex",
          gap: 12,
          padding: "5px 12px",
          background: "var(--bg3)",
          borderBottom: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--fg3)",
          flexWrap: "wrap",
          alignItems: "center",
        }}
      >
        <span style={{ fontFamily: "var(--font-mono)", fontWeight: 600, color: "var(--fg2)" }}>
          {role ?? "assistant"}
        </span>
        {model && <span style={{ color: "var(--fg3)" }}>{model.replace(/^.*\//, "")}</span>}
        {usage && (
          <>
            <span>↓{usage.input.toLocaleString()} ↑{usage.output.toLocaleString()}</span>
            {usage.cachedRead > 0 && <span title="cached read">⚡{usage.cachedRead.toLocaleString()}</span>}
          </>
        )}
        {costUsd != null && <span style={{ color: "var(--fg2)" }}>{fmtCost(costUsd)}</span>}
        {latencyMs != null && <span>{fmtLatency(latencyMs)}</span>}
      </div>

      {/* Text content */}
      {textContent && (
        <div
          style={{
            padding: "10px 14px",
            maxWidth: 720,
            lineHeight: 1.65,
          }}
        >
          <ReactMarkdown
            components={{
              code({ className, children, ...props }) {
                const isInline = !className;
                return isInline ? (
                  <code
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.85em",
                      background: "var(--bg3)",
                      padding: "1px 4px",
                      borderRadius: 3,
                    }}
                    {...props}
                  >
                    {children}
                  </code>
                ) : (
                  <code
                    style={{
                      fontFamily: "var(--font-mono)",
                      fontSize: "0.85em",
                    }}
                    {...props}
                  >
                    {children}
                  </code>
                );
              },
              pre({ children, ...props }) {
                return (
                  <pre
                    style={{
                      background: "var(--bg3)",
                      padding: "10px 12px",
                      borderRadius: 4,
                      overflow: "auto",
                      marginBottom: 8,
                      fontSize: 12,
                      fontFamily: "var(--font-mono)",
                    }}
                    {...props}
                  >
                    {children}
                  </pre>
                );
              },
            }}
          >
            {textContent}
          </ReactMarkdown>
        </div>
      )}

      {/* Tool calls */}
      {toolStartEvents.length > 0 && (
        <div style={{ padding: "8px 12px", borderTop: textContent ? "1px solid var(--border)" : undefined }}>
          {toolStartEvents.map((start) => {
            const harnessId = start.harnessId as string;
            const end = toolEndMap.get(harnessId) ?? null;
            return <ToolCallCard key={harnessId} startEvent={start} endEvent={end} />;
          })}
        </div>
      )}
    </div>
  );
}
