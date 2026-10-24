import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

/** Content-addressed store for large texts (system prompts, tool declarations, big attachments). */
export interface Blobs {
  put(text: string): string;
  putJSON(value: unknown): string;
}

/**
 * Serialises JSON with object keys sorted recursively, so equal values hash equally.
 * @param value - JSON-serialisable value
 */
export function canonicalJSON(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys);
  if (v && typeof v === "object") {
    const o = v as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const k of Object.keys(o).sort()) out[k] = sortKeys(o[k]);
    return out;
  }
  return v;
}

/**
 * SHA-256 hex of a string.
 * @param text - input text
 */
export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

/** Blob store writing `<dir>/<sha256>.txt` with `O_EXCL` so concurrent writers never clobber. */
export class BlobStore implements Blobs {
  constructor(private readonly dir: string) {}
  put(text: string): string {
    const hash = sha256(text);
    fs.mkdirSync(this.dir, { recursive: true });
    try {
      fs.writeFileSync(path.join(this.dir, `${hash}.txt`), text, { flag: "wx" });
    } catch (e) {
      // Already exists: content-addressed, so identical by construction.
      if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    }
    return hash;
  }
  putJSON(value: unknown): string {
    return this.put(canonicalJSON(value));
  }
}

/** Blob "store" that only computes hashes (nothing is persisted). */
export class NoopBlobStore implements Blobs {
  put(text: string): string {
    return sha256(text);
  }
  putJSON(value: unknown): string {
    return sha256(canonicalJSON(value));
  }
}
