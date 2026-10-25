#!/usr/bin/env node
/**
 * Builds the indexer TypeScript source into indexer/dist/index.js using esbuild.
 */
import { build } from "esbuild";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

await build({
  entryPoints: [join(__dirname, "index.ts")],
  bundle: true,
  platform: "node",
  target: "node22",
  format: "esm",
  outfile: join(__dirname, "dist", "index.js"),
  external: ["node:*", "esbuild"],
});

console.log("[build:indexer] built indexer/dist/index.js");
