/** Synthetic complete metadata for mocked scheduler tests only; never used by production code. */
import { canonicalJSON } from "@aiw/telemetry";
import { hashText } from "../src/provenance.ts";
import type { Provenance, RunConfig } from "../src/types.ts";
export function mockProvenance(config: RunConfig): Provenance {
  const hash = "a".repeat(64);
  return { commit: "a".repeat(40), dirty: false, runnerVersion: "fixture", engine: "isolated-vm", basePrompt: hash,
    frameworks: Object.fromEntries(config.frameworks.map((id) => [id, { prompt: hash, tools: hash }])),
    images: Object.fromEntries(config.problems.map((id) => [id, `sha256:${hash}`])),
    problems: Object.fromEntries(config.problems.map((id) => [id, { taskHash: hash, turnLimit: 1, wallClockMs: 180000 }])),
    integrity: { version: 1, sourceHash: hash, bundleHash: hash, entryHash: hash, promptHashes: {}, configHash: hashText(canonicalJSON(config)),
      runtime: "observed", nodeVersion: process.version, runtimePlatform: { platform: process.platform, arch: process.arch, moduleABI: process.versions.modules }, wallClockEnforced: false } };
}
