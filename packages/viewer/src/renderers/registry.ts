/**
 * Renderer registry for framework adaptations.
 * Adaptations register renderers by tool name and/or attachment key;
 * lookup falls back to the generic renderer when no match is found.
 */

import type { ReactNode } from "react";
import type { RawEvent } from "../types.js";

/** Context passed to every renderer. */
export interface RenderContext {
  jobRunId: string;
  jobName: string;
  events: RawEvent[];
}

/** A renderer for one kind of item (tool call or attachment). */
export interface Renderer<T = unknown> {
  /** Tool name or attachment key to match. */
  match: { tool?: string; attach?: string };
  /** Render the item to a ReactNode. */
  render(item: T, ctx: RenderContext): ReactNode;
}

/** Named adaptation containing a set of renderers. */
interface Adaptation {
  name: string;
  renderers: Renderer[];
}

const adaptations: Adaptation[] = [];

/**
 * Register a named adaptation with its renderers.
 * @param name - adaptation name (e.g. "branch", "orchestrate")
 * @param renderers - list of renderers for this adaptation
 */
export function registerAdaptation(name: string, renderers: Renderer[]): void {
  adaptations.push({ name, renderers });
}

/**
 * Look up a renderer for the given tool name and/or attachment key.
 * Returns null if no adaptation matches; callers fall back to generic rendering.
 * @param tool - tool name, if applicable
 * @param attach - attachment key, if applicable
 */
export function lookupRenderer(tool?: string, attach?: string): Renderer | null {
  // Search in registration order; attachment key takes priority over tool name
  for (const adaptation of adaptations) {
    for (const renderer of adaptation.renderers) {
      if (attach && renderer.match.attach === attach) return renderer;
    }
  }
  for (const adaptation of adaptations) {
    for (const renderer of adaptation.renderers) {
      if (tool && renderer.match.tool === tool) return renderer;
    }
  }
  return null;
}
