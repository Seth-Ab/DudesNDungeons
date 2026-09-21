import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { packageRoot } from "../paths.js";
import { profileFileSchema, type ProfileFile } from "./profile.js";
import type { ProfileStorage } from "./profileStore.js";

const PROFILE_FILE_NAME = "profiles.json";

/**
 * Where persistent state lives. `DATA_DIR` overrides it for a deployment that mounts a volume
 * somewhere else; the default sits beside `content/` at the package root and is gitignored.
 */
export function resolveDataRoot(override = process.env.DATA_DIR): string {
  return override ? resolve(override) : join(packageRoot(import.meta.url), "data");
}

export function profileFilePath(dataRoot = resolveDataRoot()): string {
  return join(dataRoot, PROFILE_FILE_NAME);
}

/**
 * Profiles in one JSON file. File-backed is enough at this size, per Backend step 11: a profile is
 * a few hundred bytes and a home server holds a handful of parties.
 */
export function createFileProfileStorage(path = profileFilePath()): ProfileStorage {
  return {
    read(): ProfileFile | null {
      // A missing file is the normal first run, not a problem.
      if (!existsSync(path)) return null;

      let payload: unknown;
      try {
        payload = JSON.parse(readFileSync(path, "utf8")) as unknown;
      } catch (cause) {
        throw new Error(`${path} is not valid JSON: ${(cause as Error).message}`);
      }

      const result = profileFileSchema.safeParse(payload);
      if (!result.success) {
        // Loud rather than quiet: starting with an empty store would silently wipe everything
        // every player has banked, and the file on disk would be overwritten on the first save.
        const detail = result.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
        throw new Error(`${path} is not a valid profile file: ${detail}`);
      }

      return result.data;
    },

    /**
     * Written to a temporary file and renamed over the target, because rename is atomic on every
     * platform this runs on. A crash mid-write then costs the newest save rather than every
     * profile on the server.
     */
    write(file: ProfileFile): void {
      mkdirSync(dirname(path), { recursive: true });

      const temporary = `${path}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, "utf8");
      renameSync(temporary, path);
    },
  };
}
