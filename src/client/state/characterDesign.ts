import {
  BODY_TYPES,
  HAIR_COLORS,
  HAIR_STYLES,
  SKIN_TONES,
} from "../../shared/constants/appearance.js";
import type { PlayerAppearance } from "../../shared/types/core.js";
import type { SessionError, SessionView } from "../network/sessionState.js";
import { selfOf } from "../network/sessionState.js";

/** Structural subset of `localStorage`, so this module stays free of DOM types. */
interface KeyValueStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface LookStore {
  read(): string | null;
  write(look: PlayerAppearance): void;
}

const LAST_LOOK_KEY = "dnd.lastLook";

export function createLocalStorageLookStore(storage: KeyValueStorage): LookStore {
  return {
    read() {
      try {
        return storage.getItem(LAST_LOOK_KEY);
      } catch {
        // Blocked storage just means the screen opens on a random look.
        return null;
      }
    },
    write(look) {
      try {
        storage.setItem(LAST_LOOK_KEY, JSON.stringify(look));
      } catch {
        // Losing the memory costs a re-roll next time, not the character.
      }
    },
  };
}

/** Used when storage is unavailable, so the screen still works and remembers within the page. */
export function createMemoryLookStore(): LookStore {
  let saved: string | null = null;
  return {
    read: () => saved,
    write: (look) => {
      saved = JSON.stringify(look);
    },
  };
}

function pick<T>(list: readonly T[], random: () => number): T {
  return list[Math.min(list.length - 1, Math.floor(random() * list.length))]!;
}

export function randomLook(random: () => number = Math.random): PlayerAppearance {
  return {
    body: pick(BODY_TYPES, random),
    skinTone: pick(SKIN_TONES, random),
    hairStyle: pick(HAIR_STYLES, random),
    hairColor: pick(HAIR_COLORS, random),
  };
}

/**
 * Reads a saved look, or null when it is missing, malformed, or names an id that has since been
 * removed from the shared lists. A stale entry must never reach the server, which would refuse it.
 */
export function parseStoredLook(raw: string | null): PlayerAppearance | null {
  if (raw === null) return null;
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { body, skinTone, hairStyle, hairColor } = value as Record<string, unknown>;
  if (
    !BODY_TYPES.includes(body as never) ||
    !SKIN_TONES.includes(skinTone as never) ||
    !HAIR_STYLES.includes(hairStyle as never) ||
    !HAIR_COLORS.includes(hairColor as never)
  ) {
    return null;
  }
  return { body, skinTone, hairStyle, hairColor } as PlayerAppearance;
}

/** The look the screen opens with: the last confirmed one, otherwise a random one. */
export function startingLook(store: LookStore, random: () => number = Math.random): PlayerAppearance {
  return parseStoredLook(store.read()) ?? randomLook(random);
}

export interface DesignScreenState {
  /** Whether the full-screen design step is up. */
  visible: boolean;
  /** A look was sent and the server has not answered either way yet. */
  entering: boolean;
  /** The server's refusal of the look just sent. */
  error: string | null;
  /** "Joining KX7QF · 2 of 4 here", or null before the room is known. */
  roomLine: string | null;
}

/**
 * What the design step shows for a view. It is up while the server has asked for a look and this
 * player's own entry still has none; the look arriving in a snapshot is what takes it down.
 *
 * `sentAgainst` is `view.lastError` as it stood when the look was sent, or undefined if none was.
 * A different `lastError` after that is the server answering with a refusal.
 */
export function designScreenState(
  view: SessionView,
  sentAgainst: SessionError | null | undefined,
  maxPartySize: number,
): DesignScreenState {
  const self = selfOf(view);
  const visible =
    view.phase === "inSession" &&
    view.needsAppearance &&
    (self === null || self.appearance === null);
  const answered = sentAgainst !== undefined && view.lastError !== sentAgainst && view.lastError !== null;
  return {
    visible,
    entering: visible && sentAgainst !== undefined && !answered,
    error: visible && answered ? view.lastError!.message : null,
    roomLine:
      visible && view.roomCode
        ? `Joining ${view.roomCode} · ${view.players.length} of ${maxPartySize} here`
        : null,
  };
}
