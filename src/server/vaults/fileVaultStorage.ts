import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveDataRoot } from "../profiles/fileProfileStorage.js";
import { vaultFileSchema, type VaultFile } from "./partyVault.js";
import type { VaultStorage } from "./vaultStore.js";

const VAULT_FILE_NAME = "vaults.json";

export function vaultFilePath(dataRoot = resolveDataRoot()): string {
  return join(dataRoot, VAULT_FILE_NAME);
}

/**
 * Vaults in one JSON file beside `profiles.json`, with the same rules: a missing file is a first
 * run, a file that does not parse stops the server rather than being overwritten with nothing, and
 * a write goes to a temporary file renamed over the target.
 */
export function createFileVaultStorage(path = vaultFilePath()): VaultStorage {
  return {
    read(): VaultFile | null {
      if (!existsSync(path)) return null;

      let payload: unknown;
      try {
        payload = JSON.parse(readFileSync(path, "utf8")) as unknown;
      } catch (cause) {
        throw new Error(`${path} is not valid JSON: ${(cause as Error).message}`);
      }

      const result = vaultFileSchema.safeParse(payload);
      if (!result.success) {
        const detail = result.error.issues
          .map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("; ");
        throw new Error(`${path} is not a valid vault file: ${detail}`);
      }

      return result.data;
    },

    write(file: VaultFile): void {
      mkdirSync(dirname(path), { recursive: true });

      const temporary = `${path}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(file, null, 2)}\n`, "utf8");
      renameSync(temporary, path);
    },
  };
}
