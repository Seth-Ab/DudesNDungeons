import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { PlayerName, ProfileId, ProfileSecret } from "../../shared/types/core.js";
import {
  markProfileChanged,
  PROFILE_FILE_VERSION,
  profileFileSchema,
  type PlayerProfile,
  type ProfileFile,
} from "./profile.js";

/**
 * Where profiles are read from and written to. An interface rather than a path, so the rules here
 * can be tested without touching a disk, and so a later deployment can put them in a database
 * without this file changing.
 */
export interface ProfileStorage {
  /** The stored file, or null when nothing has been written yet. Throws if it cannot be trusted. */
  read(): ProfileFile | null;
  write(file: ProfileFile): void;
}

export interface ProfileStoreOptions {
  storage?: ProfileStorage;
  now?: () => number;
  createProfileId?: () => ProfileId;
  createProfileSecret?: () => ProfileSecret;
}

/**
 * Storage that forgets everything on exit. The default, so a test or a dev run needs no file.
 *
 * Validates on write even though nothing here needs parsing, so that a profile the file-backed
 * storage would reject fails in a test rather than only on a real deployment.
 */
export function createMemoryProfileStorage(): ProfileStorage {
  let file: ProfileFile | null = null;
  return {
    read: () => file,
    write: (next) => {
      file = profileFileSchema.parse(next);
    },
  };
}

/**
 * The secret never rests on the server, in its file or in memory: only this hash of it does.
 *
 * Plain SHA-256 rather than a password hash, because a profile secret is 16 random bytes rather
 * than something a person chose. There is no dictionary to run against it and nothing to slow an
 * attacker down that guessing 2^128 would not already prevent.
 */
function hashSecret(secret: string): string {
  return createHash("sha256").update(secret, "utf8").digest("hex");
}

/**
 * The server's registry of roguelite profiles.
 *
 * Profiles are owned here and handed out by reference: a `SessionPlayer` holds the same object this
 * store persists, so banking an item at the end of a run needs no write-back step. What the store
 * still owns is when that reaches the disk, which is `flush`.
 */
export class ProfileStore {
  readonly #byId = new Map<ProfileId, PlayerProfile>();
  /** Lookup by hash, so a join costs one hash and one map read rather than a scan. */
  readonly #byHash = new Map<string, PlayerProfile>();
  /** Last revision written per profile. A profile absent from here has never been persisted. */
  readonly #persisted = new Map<ProfileId, number>();

  readonly #storage: ProfileStorage;
  readonly #now: () => number;
  readonly #createProfileId: () => ProfileId;
  readonly #createProfileSecret: () => ProfileSecret;

  constructor(options: ProfileStoreOptions = {}) {
    this.#storage = options.storage ?? createMemoryProfileStorage();
    this.#now = options.now ?? Date.now;
    this.#createProfileId = options.createProfileId ?? randomUUID;
    this.#createProfileSecret =
      options.createProfileSecret ?? (() => randomBytes(16).toString("hex"));

    for (const stored of this.#storage.read()?.profiles ?? []) {
      const profile: PlayerProfile = {
        ...stored,
        bankedItems: stored.bankedItems.map((item) => ({ ...item })),
        skillStacks: { ...stored.skillStacks },
        revision: 0,
      };
      this.#byId.set(profile.id, profile);
      this.#byHash.set(profile.secretHash, profile);
      this.#persisted.set(profile.id, 0);
    }
  }

  get size(): number {
    return this.#byId.size;
  }

  /** The profile a secret names, or null when the secret is unknown or absent. */
  find(secret: ProfileSecret | null | undefined): PlayerProfile | null {
    if (!secret) return null;
    return this.#byHash.get(hashSecret(secret)) ?? null;
  }

  get(id: ProfileId): PlayerProfile | undefined {
    return this.#byId.get(id);
  }

  /**
   * Issues a profile and the one copy of its secret that will ever leave the server.
   *
   * The caller is responsible for only doing this once a join has otherwise succeeded, so a
   * mistyped room code does not leave an empty profile behind forever.
   */
  create(displayName: PlayerName): { profile: PlayerProfile; secret: ProfileSecret } {
    const secret = this.#createProfileSecret();
    const at = this.#now();
    const profile: PlayerProfile = {
      id: this.#createProfileId(),
      secretHash: hashSecret(secret),
      displayName,
      bankedItems: [],
      skillStacks: {},
      coin: 0,
      runsEscaped: 0,
      runsLost: 0,
      createdAt: at,
      lastSeenAt: at,
      revision: 1,
    };

    this.#byId.set(profile.id, profile);
    this.#byHash.set(profile.secretHash, profile);
    return { profile, secret };
  }

  /** Records that this profile is playing again, and under what name. */
  touch(profile: PlayerProfile, displayName: PlayerName): void {
    profile.displayName = displayName;
    profile.lastSeenAt = this.#now();
    markProfileChanged(profile);
  }

  /** True when any profile holds changes that `flush` has not yet written. */
  get dirty(): boolean {
    for (const profile of this.#byId.values()) {
      if (this.#persisted.get(profile.id) !== profile.revision) return true;
    }
    return false;
  }

  /**
   * Writes every profile, if any of them changed.
   *
   * All of them rather than a delta, because the whole set is a few kilobytes at this size and a
   * partial write is the failure mode that loses a bank. Callers may call this as often as they
   * like: it does nothing when nothing changed.
   */
  flush(): void {
    if (!this.dirty) return;

    const profiles = [...this.#byId.values()];
    this.#storage.write({
      version: PROFILE_FILE_VERSION,
      profiles: profiles.map((profile) => ({
        id: profile.id,
        secretHash: profile.secretHash,
        displayName: profile.displayName,
        bankedItems: profile.bankedItems.map((item) => ({ ...item })),
        skillStacks: { ...profile.skillStacks },
        coin: profile.coin,
        runsEscaped: profile.runsEscaped,
        runsLost: profile.runsLost,
        createdAt: profile.createdAt,
        lastSeenAt: profile.lastSeenAt,
      })),
    });

    for (const profile of profiles) this.#persisted.set(profile.id, profile.revision);
  }
}
