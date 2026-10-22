import { createHash } from "node:crypto";
import type { GameContent } from "./loadContent.js";

const versions = new WeakMap<GameContent, string>();

/**
 * A short fingerprint of everything in a content catalog. Two catalogs with the same definitions get
 * the same version wherever they were loaded from, and any edit to any definition changes it.
 *
 * A saved run is only replayable against the content it was played with (decision 0015), so a run
 * saved under one version is discarded when the server starts with another. Hashed from the parsed
 * catalog rather than the files, so whitespace or key order in the JSON does not count as a change.
 */
export function contentVersion(content: GameContent): string {
  const cached = versions.get(content);
  if (cached !== undefined) return cached;

  const version = createHash("sha256").update(stableStringify(content)).digest("hex").slice(0, 16);
  versions.set(content, version);
  return version;
}

/** JSON with object keys and map entries sorted, so equal values always serialize the same way. */
function stableStringify(value: unknown): string {
  if (value instanceof Map) {
    const entries = [...value.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)));
    return `{${entries.map(([key, entry]) => `${JSON.stringify(String(key))}:${stableStringify(entry)}`).join(",")}}`;
  }
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const keys = Object.keys(value).sort();
    const fields = keys
      .filter((key) => (value as Record<string, unknown>)[key] !== undefined)
      .map((key) => `${JSON.stringify(key)}:${stableStringify((value as Record<string, unknown>)[key])}`);
    return `{${fields.join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}
