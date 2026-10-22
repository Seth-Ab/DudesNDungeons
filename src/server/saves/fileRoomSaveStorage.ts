import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { resolveDataRoot } from "../profiles/fileProfileStorage.js";
import { parseRoomSaveFile, type RoomSaveFile } from "./roomSave.js";
import type { RoomSaveStorage } from "./roomSaveStore.js";

const ROOM_SAVE_FILE_NAME = "rooms.json";

export function roomSaveFilePath(dataRoot = resolveDataRoot()): string {
  return join(dataRoot, ROOM_SAVE_FILE_NAME);
}

/**
 * Room saves in one JSON file beside `vaults.json`. A missing file is a first run, JSON that does not
 * parse stops the server rather than being overwritten, and a write goes to a temporary file renamed
 * over the target. Unlike vaults, an older format or an unreadable room is discarded rather than
 * fatal; see `parseRoomSaveFile`.
 */
export function createFileRoomSaveStorage(path = roomSaveFilePath()): RoomSaveStorage {
  return {
    read(): RoomSaveFile | null {
      if (!existsSync(path)) return null;

      let payload: unknown;
      try {
        payload = JSON.parse(readFileSync(path, "utf8")) as unknown;
      } catch (cause) {
        throw new Error(`${path} is not valid JSON: ${(cause as Error).message}`);
      }

      return parseRoomSaveFile(payload, path);
    },

    write(file: RoomSaveFile): void {
      mkdirSync(dirname(path), { recursive: true });

      const temporary = `${path}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(file)}\n`, "utf8");
      renameSync(temporary, path);
    },
  };
}
