/**
 * Resolve run configuration from CLI flags and compute provenance fields.
 * Runner architecture §9; framework-runner §6.6, §7.1.
 */

import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { DEFAULT_TRACE_LIMITS, parseFrameworkVariant } from "@aiw/core";
import type { RunConfig, Provenance, Tier, BranchContext } from "./types.ts";

import { validateSubscriptionLimits, type SubscriptionLimits } from "./subscription.ts";

export { RunConfig, Provenance };

/** Package version read from package.json. */
function runnerVersion(): string {
  const req = createRequire(import.meta.url);
  const pkg = req("../package.json") as { version?: string };
  return pkg.version ?? "0.0.0";
}

/**
 * Parses one framework variant string. Format: `base[key=value,...]`.
 * Keys are sorted to produce the canonical id.
 * @param raw - variant string as typed by the user
 * @returns canonical variant string
 */
export function parseVariant(raw: string): string {
  return parseFrameworkVariant(raw).id;
}

/** The three modes that `compare` expands to. */
export const COMPARE_MODES = ["baseline", "branch-only", "orchestrate"] as const;

/**
 * Expands mode tokens into canonical framework variant strings.
 * `compare` → baseline, branch-only, orchestrate. Each is then passed through `parseVariant`.
 * @param modes - comma or space-separated mode tokens from `--mode`
 * @returns deduplicated list of canonical variant strings
 */
export function expandModes(modes: string): string[] {
  // Split on whitespace or commas that are NOT inside brackets, to allow variant[k=v,k=v].
  const tokens: string[] = [];
  let depth = 0;
  let current = "";
  for (const ch of modes) {
    if (ch === "[") { depth++; current += ch; }
    else if (ch === "]") { depth--; current += ch; }
    else if ((ch === "," || ch === " ") && depth === 0) {
      if (current.trim()) tokens.push(current.trim());
      current = "";
    } else {
      current += ch;
    }
  }
  if (current.trim()) tokens.push(current.trim());
  const expanded: string[] = [];
  for (const tok of tokens) {
    if (tok === "compare") {
      for (const m of COMPARE_MODES) expanded.push(m);
    } else {
      expanded.push(parseVariant(tok));
    }
  }
  // Deduplicate preserving order
  return [...new Set(expanded)];
}

/**
 * Problem selectors (runner §2). Returns the matching problem ids.
 * @param selector - `all`, `small`, `large`, `dev`, `smoke`, or comma-separated ids
 * @param availableProblems - problems loaded from the problem registry
 */
export function selectProblems(
  selector: string,
  availableProblems: Array<{ id: string; size: string; set: string }>,
): string[] {
  switch (selector) {
    case "all":
      return availableProblems.filter((p) => p.set === "reported").map((p) => p.id);
    case "small":
      return availableProblems.filter((p) => p.set === "reported" && p.size === "small").map((p) => p.id);
    case "large":
      return availableProblems.filter((p) => p.set === "reported" && p.size === "large").map((p) => p.id);
    case "dev":
      return availableProblems.filter((p) => p.set === "dev").map((p) => p.id);
    case "smoke":
      return availableProblems.filter((p) => p.size === "smoke").map((p) => p.id);
    default:
      // Comma-separated explicit ids
      return selector.split(",").map((s) => s.trim()).filter(Boolean);
  }
}

/**
 * Determines run kind from flags and selected problems (runner §2).
 * @param full - --full flag
 * @param problems - selected problem objects
 */
export function resolveKind(
  full: boolean,
  problems: Array<{ set: string; size: string }>,
): "dev" | "pilot" | "full" {
  if (full) return "full";
  if (problems.every((p) => p.set === "dev" || p.size === "smoke")) return "dev";
  return "pilot";
}

/** Conservative campaign default: calibrate one paid task at a time. */
export const DEFAULT_CONCURRENCY = 1;

/** Options parsed from `aiw eval` flags. */
export interface EvalFlags {
  problems: string;
  mode: string;
  tools: Tier;
  reps: number;
  model: string;
  secondaryModel?: string;
  temperature: number;
  budget: number;
  full: boolean;
  concurrency?: number;
  branchContext: BranchContext;
  secondaryCap: number;
  untilReps?: number;
  combineWith?: string;
  provider?: "openrouter" | "chatgpt" | "deepseek";
  usageMode?: "monetary" | "subscription" | "estimated";
  estimatedLimits?: import("./estimated.ts").EstimatedLimits;
  subscriptionLimits?: SubscriptionLimits;
}

/**
 * Validates that the model is not an Anthropic model on OpenRouter (runner §3).
 * @param model - model id
 * @throws Error if the model is disallowed
 */
export function validateModel(model: string): void {
  if (/^anthropic\//i.test(model)) {
    throw new Error(`Model "${model}" is not allowed; use deepseek/deepseek-v4-flash (runner §3)`);
  }
}

/** SHA-256 of a string as hex. */
function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Reads the base prompt file and returns its SHA-256. */
function basePromptHash(): string {
  // Resolve relative to this package's location
  const dir = fileURLToPath(new URL("../../core/prompts/base.md", import.meta.url));
  return sha256(readFileSync(dir, "utf8"));
}

/**
 * Computes git provenance: commit hash and dirty flag.
 * @param cwd - working directory for git commands
 */
export function gitProvenance(cwd: string): { commit: string; dirty: boolean } {
  const commit = execSync("git rev-parse HEAD", { cwd, encoding: "utf8" }).trim();
  const status = execSync("git status --porcelain", { cwd, encoding: "utf8" }).trim();
  if (!/^[a-f0-9]{40,64}$/.test(commit)) throw new Error("git did not report a valid commit");
  return { commit, dirty: status.length > 0 };
}

/**
 * Builds a partial Provenance record from static sources (basePrompt, commit, version).
 * Framework fingerprints and image digests are filled in later by the runner.
 * @param cwd - repo root for git commands
 */
export function buildProvenance(cwd: string): Omit<Provenance, "frameworks" | "images" | "problems"> {
  const git = gitProvenance(cwd);
  return {
    commit: git.commit,
    dirty: git.dirty,
    runnerVersion: runnerVersion(),
    engine: "pending",
    basePrompt: basePromptHash(),
  };
}

/** Default branch config used when flags are not supplied. */
export const DEFAULT_BRANCH_CONFIG = {
  context: "trace" as BranchContext,
  timeoutMs: 120_000,
  limits: DEFAULT_TRACE_LIMITS,
};

/**
 * Resolves a `RunConfig` from evaluated CLI flags and available problems.
 * Throws on validation failures (bad model, no problems, etc.).
 * @param flags - parsed eval flags
 * @param availableProblems - full problem registry for selector resolution
 * @returns resolved config
 */
export function resolveConfig(
  flags: EvalFlags,
  availableProblems: Array<{ id: string; size: string; set: string }>,
): RunConfig {
  const concurrency = flags.concurrency ?? DEFAULT_CONCURRENCY;
  if (!Number.isSafeInteger(concurrency) || concurrency < 1) throw new Error("concurrency must be a positive integer");
  const provider = flags.provider ?? "openrouter";
  const usageMode = flags.usageMode ?? "monetary";
  if (provider !== "openrouter" && provider !== "chatgpt" && provider !== "deepseek") throw new Error("Unknown provider");
  if (usageMode !== "monetary" && usageMode !== "subscription" && usageMode !== "estimated") throw new Error("Unknown usage mode");
  if ((provider === "deepseek") !== (usageMode === "estimated")) throw new Error("DeepSeek requires explicit estimated usage mode");
  if ((provider === "chatgpt") !== (usageMode === "subscription")) throw new Error("ChatGPT requires explicit subscription usage mode; OpenRouter requires monetary mode");
  if (provider === "chatgpt") {
    if (!flags.subscriptionLimits) throw new Error("Subscription usage requires explicit call, token and duration limits");
    validateSubscriptionLimits(flags.subscriptionLimits);
    if (concurrency !== 1) throw new Error("Subscription campaigns require concurrency 1");
    if (!flags.model || flags.model.includes("/")) throw new Error("Select an explicit account-available OpenAI model slug");
  } else if (flags.subscriptionLimits) throw new Error("Subscription limits require ChatGPT provider");
  if (provider === "deepseek") {
    if (!flags.estimatedLimits) throw new Error("DeepSeek requires explicit estimate, call, token and duration limits");
    validateSubscriptionLimits(flags.estimatedLimits);
    if (!Number.isFinite(flags.estimatedLimits.estimateLimitUsd) || flags.estimatedLimits.estimateLimitUsd <= 0) throw new Error("Invalid estimate limit");
    if (concurrency !== 1) throw new Error("DeepSeek campaigns require concurrency 1");
    if (flags.model !== "deepseek-flash" || (flags.secondaryModel && flags.secondaryModel !== "deepseek-flash")) throw new Error("Select deepseek-flash; retired aliases are not supported");
  } else if (flags.estimatedLimits) throw new Error("Estimated limits require DeepSeek provider");
  validateModel(flags.model);
  if (flags.secondaryModel) validateModel(flags.secondaryModel);

  const frameworks = expandModes(flags.mode);
  if (frameworks.length === 0) throw new Error("No framework modes selected (--mode)");

  const problemIds = selectProblems(flags.problems, availableProblems);
  if (problemIds.length === 0) throw new Error("No problems selected (--problems)");

  const selectedProblems = problemIds.map((id) => {
    const p = availableProblems.find((ap) => ap.id === id);
    return p ?? { id, set: "dev", size: "smoke" };
  });

  const kind = resolveKind(flags.full, selectedProblems);

  return {
    kind,
    problems: problemIds,
    frameworks,
    tier: flags.tools,
    reps: flags.reps,
    budgetUsd: usageMode !== "monetary" ? null : flags.budget,
    provider, usageMode,
    ...(flags.estimatedLimits ? { estimatedLimits: flags.estimatedLimits } : {}),
    ...(flags.subscriptionLimits ? { subscriptionLimits: flags.subscriptionLimits } : {}),
    concurrency,
    models: {
      main: flags.model,
      secondary: flags.secondaryModel ?? flags.model,
    },
    temperature: flags.temperature,
    secondaryCap: flags.secondaryCap,
    branch: {
      context: flags.branchContext,
      timeoutMs: DEFAULT_BRANCH_CONFIG.timeoutMs,
      limits: DEFAULT_BRANCH_CONFIG.limits,
    },
  };
}
