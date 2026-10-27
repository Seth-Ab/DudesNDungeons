import type { ChestState, EntityId, PlayerId } from "../../shared/types/core.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { isDown } from "./dungeonState.js";

/**
 * Server-resolved Twin-lock Chests.
 *
 * A twin-lock chest has two keyholes. Interacting turns one and holds it for `TWIN_LOCK_WINDOW_MS`;
 * a different player interacting inside that window turns the second and the chest opens. The
 * server records who turned the first and when from its own clock, so a client can never say it
 * turned both, and one player interacting twice only turns the same keyhole again.
 */

/** How long a turned keyhole waits for the second player. */
export const TWIN_LOCK_WINDOW_MS = 1000;

/** The smallest party that can open one. The generator never places one for fewer. */
export const TWIN_LOCK_MIN_PARTY = 2;

/** Who turned a twin lock's first keyhole, and when. */
export interface TwinLockTurn {
  readonly playerId: PlayerId;
  readonly at: number;
}

/**
 * Whether a turn still holds: inside the window, by a player still in the party, connected and
 * standing. A dropped connection or a downed body lets go of the keyhole, as it lets go of a plate.
 */
function holding(session: Session, turn: TwinLockTurn, now: number): boolean {
  const player = session.players.get(turn.playerId);
  return now - turn.at <= TWIN_LOCK_WINDOW_MS && player !== undefined && player.connected && !isDown(player);
}

/**
 * Turns a keyhole of an unopened twin-lock chest the player can already reach. Returns true when
 * that was the second keyhole, turned by a different player inside the window, so the chest opens;
 * false when it only turned (or turned again) the first. Changes `keyTurnedBy` and the session's turn
 * either way.
 */
export function turnTwinLock(session: Session, player: SessionPlayer, chest: ChestState, now: number): boolean {
  const first = session.twinLockTurns.get(chest.id);
  if (first && first.playerId !== player.id && holding(session, first, now)) {
    session.twinLockTurns.delete(chest.id);
    chest.keyTurnedBy = null;
    return true;
  }

  session.twinLockTurns.set(chest.id, { playerId: player.id, at: now });
  chest.keyTurnedBy = player.id;
  return false;
}

/**
 * Lets go of every turned keyhole whose window has passed, whose turner dropped or went down, or
 * whose chest is gone or open, and keeps each chest's `keyTurnedBy` in step with what is still held.
 * Run every tick, so a missed second turn resets the chest instead of waiting forever.
 */
export function resolveTwinLocks(session: Session, now: number): void {
  const live = new Set<EntityId>();
  for (const chest of session.dungeon.chests) {
    if (!chest.twinLock) continue;
    const turn = session.twinLockTurns.get(chest.id);
    const held = !chest.opened && turn !== undefined && holding(session, turn, now);
    chest.keyTurnedBy = held ? turn.playerId : null;
    if (held) live.add(chest.id);
  }
  for (const id of session.twinLockTurns.keys()) if (!live.has(id)) session.twinLockTurns.delete(id);
}
