/**
 * Renders the full conversation reconstructed from events.jsonl.
 * Groups events by turn and renders each turn as a MessageCard.
 */

import type { RawEvent } from "../types.js";
import { MessageCard } from "./MessageCard.js";

interface Props {
  events: RawEvent[];
}

interface Turn {
  turnEvent: RawEvent;
  textEvents: RawEvent[];
  toolStartEvents: RawEvent[];
}

/**
 * Groups events into turns. Each `turn` event starts a new turn group;
 * subsequent text and toolStart/tool events belong to the same turn until
 * the next `turn` event.
 */
function groupIntoTurns(events: RawEvent[]): Turn[] {
  const turns: Turn[] = [];
  let current: Turn | null = null;

  // Build a map from harnessId to tool end event
  const toolEndMap = new Map<string, RawEvent>();
  for (const e of events) {
    if (e.kind === "tool" || e.kind === "toolEnd") {
      const harnessId = e.harnessId as string | undefined;
      if (harnessId) toolEndMap.set(harnessId, e);
    }
  }

  for (const e of events) {
    switch (e.kind) {
      case "turn":
        current = { turnEvent: e, textEvents: [], toolStartEvents: [] };
        turns.push(current);
        break;
      case "text":
        if (current) current.textEvents.push(e);
        break;
      case "toolStart":
        if (current) current.toolStartEvents.push(e);
        break;
      // tool/toolEnd events are looked up by harnessId, not pushed here
    }
  }

  return turns;
}

export function ConversationView({ events }: Props) {
  const turns = groupIntoTurns(events);

  // Build harnessId -> end event map for the entire event list
  const toolEndMap = new Map<string, RawEvent>();
  for (const e of events) {
    if (e.kind === "tool" || e.kind === "toolEnd") {
      const harnessId = e.harnessId as string | undefined;
      if (harnessId) toolEndMap.set(harnessId, e);
    }
  }

  if (turns.length === 0) {
    return (
      <div style={{ color: "var(--fg3)", padding: 20, textAlign: "center" }}>
        No conversation turns found.
      </div>
    );
  }

  return (
    <div style={{ padding: "12px 0" }}>
      {turns.map((turn, i) => (
        <MessageCard
          key={i}
          turnEvent={turn.turnEvent}
          textEvents={turn.textEvents}
          toolStartEvents={turn.toolStartEvents}
          toolEndMap={toolEndMap}
        />
      ))}
    </div>
  );
}
