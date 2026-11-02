import type { HotPathSnippet } from "./types.ts";

/** Input: state.cmd (explicit caller-supplied command, never interpolated); no retries or constructed shell fragments. */
export const snippet: HotPathSnippet = {
  id: "command-nonzero-summary",
  description: "Run an explicitly supplied workspace command; classify nonzero exit, timeout or abort and return a bounded tail of combined stdout and stderr.",
  tools: ["bash"],
  outcome: "nonzero-exit",
  code: String.raw`async (tools, state) => {
  const { cmd } = state;
  if (typeof cmd !== "string" || !cmd.trim() || cmd.length > 4000 || /[\x00]/.test(cmd)) throw new Error("invalid command");
  const result = await tools.bash({ cmd, timeoutMs: 10000 });
  const kind = result.code === 0 ? "success" : result.code === 124 ? "timeout" : result.code === 130 ? "aborted" : "nonzero-exit";
  return { code: result.code, kind, outputTail: result.out.slice(-2000) };
}`,
};
