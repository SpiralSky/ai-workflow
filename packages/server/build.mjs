#!/usr/bin/env node
/**
 * Bundles the server into dist/aiw-server.mjs and copies external packages + prompts alongside it.
 * Run with: node build.mjs (from packages/server/)
 *
 * The bundle uses `readFileSync(new URL("../../prompts/...", import.meta.url))` which in the
 * source tree resolves to packages/core/prompts/. In the bundle, import.meta.url points to the
 * bundle file itself, so "../../prompts/" would escape the bundle directory. We patch the output
 * to "../../prompts/" → "./prompts/" and copy the prompts into dist/prompts/.
 */
import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, "../..");
const outDir = resolve(__dirname, "dist");
const bundlePath = resolve(outDir, "aiw-server.mjs");

// Clean dist
rmSync(outDir, { recursive: true, force: true });
mkdirSync(outDir, { recursive: true });

await build({
  entryPoints: [resolve(__dirname, "src/cli.ts")],
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node22",
  outfile: bundlePath,
  external: ["isolated-vm", "typescript-api"],
  logLevel: "warning",
});

// Patch prompt path: "../../prompts/" → "./prompts/" so readFileSync resolves inside dist/.
let bundle = readFileSync(bundlePath, "utf8");
const patched = bundle.replaceAll('"../../prompts/"', '"./prompts/"');
if (patched === bundle) throw new Error("Prompt path not found in bundle — check prompts.ts");
writeFileSync(bundlePath, patched);

// Copy prompt files into dist/prompts/.
cpSync(resolve(root, "packages/core/prompts"), resolve(outDir, "prompts"), { recursive: true });

// Copy external native/CJS packages so Node can resolve them from the bundle's location.
mkdirSync(resolve(outDir, "node_modules"), { recursive: true });
for (const pkg of ["isolated-vm", "typescript-api"]) {
  cpSync(resolve(root, "node_modules", pkg), resolve(outDir, "node_modules", pkg), { recursive: true });
}

console.log("Built: dist/aiw-server.mjs + dist/prompts/ + dist/node_modules/{isolated-vm,typescript-api}");
