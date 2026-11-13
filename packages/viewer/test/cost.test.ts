import test from "node:test";
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import React from "react";
// The root Node loader uses classic JSX; Vite uses the automatic runtime.
(globalThis as unknown as { React: typeof React }).React = React;
const { Summary } = await import("../src/views/" + "Summary.tsx");
const { FrameworkTabs } = await import("../src/app/" + "FrameworkTabs.tsx");
import type { RunEntry } from "../src/types.ts";

test("viewer summaries show unknown costs instead of zero, NaN, or throwing", () => {
  const run = { frameworks: ["orchestrate"], jobs: [
    { framework: "orchestrate", outcome: "pass", costUsdAllAttempts: null },
    { framework: "orchestrate", outcome: "pass", costUsdAllAttempts: 1 },
  ] } as RunEntry;
  for (const html of [renderToStaticMarkup(React.createElement(Summary, { run, framework: "orchestrate" })),
    renderToStaticMarkup(React.createElement(FrameworkTabs, { run, selectedFramework: "orchestrate", onSelect: () => {} }))]) {
    assert.match(html, /unknown/);
    assert.doesNotMatch(html, /NaN|\$0\.0000|\$0\.5000/);
  }
});
