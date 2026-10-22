import type { ProfileId, RoomCode } from "../../shared/types/core.js";
import type { Session } from "../sessions/sessionStore.js";
import { captureMembers, captureRun, type PersistedRun } from "./roomSave.js";
import type { RoomSaveStore } from "./roomSaveStore.js";

export interface SaveRoomOptions {
  /**
   * A profile whose run entry must not survive this save: a player who left on purpose and so
   * abandoned their carry. Members who saved and quit are kept by default; this is the exception.
   */
  forget?: ProfileId;
}

/**
 * Writes the room's save from its live session (decision 0015): the party's characters always, and
 * the run only while the session is in the dungeon.
 *
 * A session in the hub never has run state of its own, so it keeps whatever run the store already
 * holds (a saved run no one has continued yet) rather than dropping it; an escape or a wipe is what
 * clears one, through `returnToHub`. Nothing is written for a room that has no characters and no
 * save, so a lobby nobody has designed in leaves no file behind.
 *
 * `now` is the game clock that timers are measured on, and `wallNow` the wall clock that dates the
 * save for its expiry. Only changes `store` in memory; the caller flushes.
 */
export function saveRoom(
  session: Session,
  store: RoomSaveStore,
  now: number,
  wallNow: number,
  options: SaveRoomOptions = {},
): void {
  const previous = store.get(session.roomCode);
  const members = captureMembers(session, previous?.members);
  if (members.length === 0 && previous === undefined) return;

  let previousRun: PersistedRun | null = previous?.run ?? null;
  if (previousRun !== null && options.forget !== undefined) {
    previousRun = {
      ...previousRun,
      players: previousRun.players.filter((entry) => entry.profileId !== options.forget),
    };
  }

  const run =
    session.location === "dungeon" ? captureRun(session, now, store.contentVersion, previousRun) : previousRun;
  store.put({ roomCode: session.roomCode, lastPlayedAt: wallNow, members, run });
}

/** Marks an existing save as played just now, so joining a room keeps it from expiring. */
export function touchRoomSave(store: RoomSaveStore, roomCode: RoomCode, wallNow: number): void {
  const save = store.get(roomCode);
  if (save === undefined) return;
  store.put({ ...save, lastPlayedAt: wallNow });
}
