import type { TokenStore } from "./sessionClient.js";

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
