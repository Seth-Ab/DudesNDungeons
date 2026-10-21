import type { RoomCode } from "../../shared/types/core.js";
import { VAULT_FILE_VERSION, vaultFileSchema, type PartyVault, type VaultFile } from "./partyVault.js";

/** Where vaults are read from and written to; see `ProfileStorage`, which this mirrors. */
export interface VaultStorage {
  /** The stored file, or null when nothing has been written yet. Throws if it cannot be trusted. */
  read(): VaultFile | null;
  write(file: VaultFile): void;
}

/** Storage that forgets everything on exit, and validates on write like the profile one. */
export function createMemoryVaultStorage(): VaultStorage {
  let file: VaultFile | null = null;
  return {
    read: () => file,
    write: (next) => {
      file = vaultFileSchema.parse(next);
    },
  };
}

/**
 * The server's registry of party vaults, keyed by room code.
 *
 * Vaults are handed out by reference, like profiles: a `Session` holds the same object this store
 * persists. A vault is written only once something has changed it, so a room nobody ever deposited
 * in leaves nothing on disk and nothing to reopen after a restart.
 */
export class VaultStore {
  readonly #byRoomCode = new Map<RoomCode, PartyVault>();
  /** Last revision written per room. A room absent from here has never been persisted. */
  readonly #persisted = new Map<RoomCode, number>();
  readonly #storage: VaultStorage;

  constructor(storage: VaultStorage = createMemoryVaultStorage()) {
    this.#storage = storage;

    for (const stored of this.#storage.read()?.vaults ?? []) {
      this.#byRoomCode.set(stored.roomCode, {
        roomCode: stored.roomCode,
        items: stored.items.map((item) => ({ ...item })),
        runCount: stored.runCount,
        revision: 0,
      });
      this.#persisted.set(stored.roomCode, 0);
    }
  }

  get size(): number {
    return this.#byRoomCode.size;
  }

  /**
   * True when this room has a vault worth keeping: one that was saved, or one changed since it was
   * opened. Such a room code stays reserved, so a new room is never handed someone else's vault.
   */
  has(roomCode: RoomCode): boolean {
    const vault = this.#byRoomCode.get(roomCode);
    return vault !== undefined && (this.#persisted.has(roomCode) || vault.revision > 0);
  }

  /** The room's vault, created empty when it has none yet. */
  open(roomCode: RoomCode): PartyVault {
    const existing = this.#byRoomCode.get(roomCode);
    if (existing) return existing;

    const vault: PartyVault = { roomCode, items: [], runCount: 0, revision: 0 };
    this.#byRoomCode.set(roomCode, vault);
    return vault;
  }

  /** True when any vault holds changes that `flush` has not yet written. */
  get dirty(): boolean {
    for (const vault of this.#byRoomCode.values()) {
      if ((this.#persisted.get(vault.roomCode) ?? 0) !== vault.revision) return true;
    }
    return false;
  }

  /** Writes every vault worth keeping, if any changed. Cheap to call when nothing did. */
  flush(): void {
    if (!this.dirty) return;

    const kept = [...this.#byRoomCode.values()].filter((vault) => this.has(vault.roomCode));
    this.#storage.write({
      version: VAULT_FILE_VERSION,
      vaults: kept.map((vault) => ({
        roomCode: vault.roomCode,
        items: vault.items.map((item) => ({ ...item })),
        runCount: vault.runCount,
      })),
    });

    for (const vault of kept) this.#persisted.set(vault.roomCode, vault.revision);
  }
}
