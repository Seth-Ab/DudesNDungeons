import type { ProfileSecretStore, TokenStore } from "./sessionClient.js";

/** Must match the server's default in `src/server/index.ts`. */
const DEFAULT_WS_URL = "ws://localhost:8080";

export interface Endpoints {
  httpUrl: string;
  wsUrl: string;
}

/**
 * One env var drives both origins. Configuring them separately invites a client that opens sockets
 * against one server while creating rooms on another.
 */
export function resolveEndpoints(configuredWsUrl?: string): Endpoints {
  const wsUrl = (configuredWsUrl ?? "").trim() || DEFAULT_WS_URL;
  const httpUrl = wsUrl.replace(/^ws(s?):\/\//, "http$1://").replace(/\/$/, "");
  return { httpUrl, wsUrl };
}

/** Structural subset of `sessionStorage`, so this module stays free of DOM types. */
export interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/**
 * Resume tokens live in session storage, not local storage: they are credentials, and the slot one
 * unlocks expires within a minute, so surviving the tab would be a liability rather than a feature.
 */
export function createSessionStorageTokenStore(storage: KeyValueStorage): TokenStore {
  const keyFor = (roomCode: string): string => `dnd.resumeToken.${roomCode}`;

  return {
    read(roomCode) {
      try {
        return storage.getItem(keyFor(roomCode));
      } catch {
        // Private-mode browsers can throw on access; a missing token just means a fresh join.
        return null;
      }
    },
    write(roomCode, token) {
      try {
        storage.setItem(keyFor(roomCode), token);
      } catch {
        // Losing the token costs a reconnect, not the session.
      }
    },
    clear(roomCode) {
      try {
        storage.removeItem(keyFor(roomCode));
      } catch {
        // Nothing to do; the token expires server-side regardless.
      }
    },
  };
}

/** Used when storage is unavailable, so the client still runs with reconnect degraded. */
export function createMemoryTokenStore(): TokenStore {
  const tokens = new Map<string, string>();
  return {
    read: (roomCode) => tokens.get(roomCode) ?? null,
    write: (roomCode, token) => {
      tokens.set(roomCode, token);
    },
    clear: (roomCode) => {
      tokens.delete(roomCode);
    },
  };
}

const PROFILE_SECRET_KEY = "dnd.profileSecret";

/**
 * The profile secret lives in local storage, not session storage, which is the opposite of the
 * resume token above and for the opposite reason: a resume token unlocks one slot for a minute,
 * while this names everything the player has ever banked. Losing it to a closed tab would mean
 * starting the roguelite progression again, so it has to outlive the tab.
 *
 * Per-origin, so a player who plays from two browsers has two profiles. That matches the recorded
 * checkpoint: identity is device-local first, and real accounts are deferred.
 */
export function createLocalStorageProfileSecretStore(storage: KeyValueStorage): ProfileSecretStore {
  return {
    read() {
      try {
        return storage.getItem(PROFILE_SECRET_KEY);
      } catch {
        // Blocked storage reads as a new device: the server will issue a fresh profile.
        return null;
      }
    },
    write(secret) {
      try {
        storage.setItem(PROFILE_SECRET_KEY, secret);
      } catch {
        // Nothing to do. The run still plays; it just banks into a profile this browser will not
        // find again, which is the same outcome as a player who cleared their storage.
      }
    },
  };
}

/** Used when local storage is unavailable. Progression then lasts as long as the page does. */
export function createMemoryProfileSecretStore(): ProfileSecretStore {
  let secret: string | null = null;
  return {
    read: () => secret,
    write: (next) => {
      secret = next;
    },
  };
}
