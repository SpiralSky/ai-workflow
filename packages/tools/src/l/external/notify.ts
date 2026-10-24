import { objectSchema, type ToolDef } from "../../types.ts";
import { fixtureResult } from "./fixtures.ts";

/** `notify`: fixture-backed `external` tool (tool-catalog §5); no real network or side effects. */
export const notify: ToolDef = {
  name: "notify",
  description: "Post a message to a team chat channel.",
  parameters: objectSchema(
    {
      channel: { type: "string", description: "Channel name, e.g. #eng-alerts." },
      message: { type: "string", description: "Message text." },
    },
    ["channel", "message"],
  ),
  returns: "{ ok: boolean; channel: string; ts: string }",
  meta: {
    whenToUse: "Tell the team something in chat, such as a status update or a heads-up.",
    whenNotToUse: "Not for commenting on a ticket (use issues) or reporting your own changes (use diff).",
    examples: ["post a status update to #eng", "alert #oncall about a failure"],
    category: "external",
    effect: "external",
    requires: [],
    cost: 2,
  },
  async fn(args: { channel: string; message: string }) {
    return fixtureResult("notify", args);
  },
};
