import type { RoomCode } from "../../shared/types/core.js";
import { contentVersion } from "../content/contentVersion.js";
import { gameContent } from "../content/loadContent.js";
import {
  ROOM_SAVE_FILE_VERSION,
  ROOM_SAVE_TTL_MS,
  roomSaveFileSchema,
  runIsCurrent,
  type RoomSave,
  type RoomSaveFile,
} from "./roomSave.js";

/** Where room saves are read from and written to; see `VaultStorage`, which this mirrors. */
export interface RoomSaveStorage {
  /** The stored file, or null when there is nothing to load. Throws if it cannot be trusted. */
  read(): RoomSaveFile | null;
  write(file: RoomSaveFile): void;
}

/** Storage that forgets everything on exit, and validates on write like the vault one. */
export function createMemoryRoomSaveStorage(): RoomSaveStorage {
  let file: RoomSaveFile | null = null;
  return {
    read: () => (file === null ? null : structuredClone(file)),
    write: (next) => {
      file = roomSaveFileSchema.parse(structuredClone(next));
    },
  };
}

export interface RoomSaveStoreOptions {
  now?: () => number;
  /** The content version runs must match to load. Defaults to the loaded catalog's. */
  contentVersion?: string;
  ttlMs?: number;
}

/**
 * The server's room saves, one per room code (decision 0015).
 *
 * On load it deletes saves not played for `ROOM_SAVE_TTL_MS`, and clears the run of any save made
 * under other content or another protocol while keeping its members. Saves are copied in and out,
 * never shared by reference: a save is a snapshot of a session, not live state, so nothing but
 * `put` may change one.
 */
export class RoomSaveStore {
  readonly #byRoomCode = new Map<RoomCode, RoomSave>();
  readonly #storage: RoomSaveStorage;
  readonly contentVersion: string;
  #revision = 0;
  #persistedRevision = 0;

  constructor(storage: RoomSaveStorage = createMemoryRoomSaveStorage(), options: RoomSaveStoreOptions = {}) {
    this.#storage = storage;
    this.contentVersion = options.contentVersion ?? contentVersion(gameContent());

    const now = (options.now ?? Date.now)();
    const ttlMs = options.ttlMs ?? ROOM_SAVE_TTL_MS;
    const stored = this.#storage.read()?.rooms ?? [];

    for (const save of stored) {
      if (now - save.lastPlayedAt > ttlMs) continue;
      const run = save.run !== null && runIsCurrent(save.run, this.contentVersion) ? save.run : null;
      this.#byRoomCode.set(save.roomCode, { ...save, run });
    }

    // Anything dropped above has to leave the file too, or the next restart would find it again.
    if (this.#byRoomCode.size !== stored.length || stored.some((save) => this.#byRoomCode.get(save.roomCode)?.run !== save.run)) {
      this.#revision += 1;
    }
  }

  get size(): number {
    return this.#byRoomCode.size;
  }

  /** True when this room code has a save, which keeps the code reserved for its party. */
  has(roomCode: RoomCode): boolean {
    return this.#byRoomCode.has(roomCode);
  }

  /** A copy of the room's save, or undefined when it has none. */
  get(roomCode: RoomCode): RoomSave | undefined {
    const save = this.#byRoomCode.get(roomCode);
    return save === undefined ? undefined : structuredClone(save);
  }

  /** Replaces the room's save with a copy of `save`. */
  put(save: RoomSave): void {
    this.#byRoomCode.set(save.roomCode, structuredClone(save));
    this.#revision += 1;
  }

  /** Drops the room's run and keeps its members: what an escape or a wipe does. */
  clearRun(roomCode: RoomCode): void {
    const save = this.#byRoomCode.get(roomCode);
    if (save === undefined || save.run === null) return;
    save.run = null;
    this.#revision += 1;
  }

  /** Forgets the room entirely, members and run: what starting fresh does. */
  delete(roomCode: RoomCode): void {
    if (this.#byRoomCode.delete(roomCode)) this.#revision += 1;
  }

  /** True when a change has not yet been written by `flush`. */
  get dirty(): boolean {
    return this.#revision !== this.#persistedRevision;
  }

  /** Writes every save, if anything changed. Cheap to call when nothing did. */
  flush(): void {
    if (!this.dirty) return;
    this.#storage.write({ version: ROOM_SAVE_FILE_VERSION, rooms: [...this.#byRoomCode.values()] });
    this.#persistedRevision = this.#revision;
  }
}
