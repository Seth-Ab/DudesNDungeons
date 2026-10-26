import {
  CAMP_REST_RESISTANCE,
  CAMP_REST_SEATED_MS,
  PLAYER_MAX_RESISTANCE,
} from "../../shared/constants/game.js";
import { roomAt } from "../../shared/game/rooms.js";
import type { RoomState } from "../../shared/types/core.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { isDown, isSpawned } from "./dungeonState.js";
import { contentForSession, progressionEffectTotal } from "./progression.js";
import { restoreResistance } from "./vitals.js";

/**
 * Campfire Rest. A `camp` room has a fire with seats round it. When every standing, connected
 * player has sat at its seats for `CAMP_REST_SEATED_MS`, each of them regains `CAMP_REST_RESISTANCE`
 * resistance, once per camp per run. Health is not touched: a camp is a breather, not a heal.
 *
 * The countdown lives in `session.campSeatedSince` and the camps already spent in
 * `session.campsRested`, both server-side. The seats themselves are ordinary map seats, so sitting
 * and standing go through `seats.ts`; this file only judges whether the party is rested.
 */

/** Players the rest waits on: in the world, connected and on their feet. A downed player never counts. */
function standingPlayers(session: Session): SessionPlayer[] {
  return [...session.players.values()].filter(
    (player) => player.connected && isSpawned(player) && !isDown(player),
  );
}

function seatsOf(session: Session, camp: RoomState): ReadonlySet<string> {
  const ids = (session.dungeon.map.seats ?? [])
    .filter((seat) => roomAt([camp], seat) !== null)
    .map((seat) => seat.id);
  return new Set(ids);
}

/** Whether `camp` still waits on the party: it is a camp with seats, not yet spent. */
function pending(session: Session, camp: RoomState): boolean {
  return camp.kind === "camp" && !session.campsRested.has(camp.id);
}

/** Advances every camp's countdown, and rests the party at one whose countdown completes. */
export function advanceCamps(session: Session, now: number): void {
  if (session.location !== "dungeon") return;

  const standing = standingPlayers(session);

  for (const camp of session.dungeon.rooms) {
    if (!pending(session, camp)) continue;

    const seats = seatsOf(session, camp);
    const seated =
      standing.length > 0 &&
      seats.size > 0 &&
      standing.every(
        (player) => player.seatId !== null && seats.has(player.seatId),
      );
    if (!seated) {
      session.campSeatedSince.delete(camp.id);
      continue;
    }

    // Whoever stands up, disconnects or goes down changes the party and so restarts the count.
    const party = standing
      .map((player) => player.id)
      .sort()
      .join(",");
    const held = session.campSeatedSince.get(camp.id);
    const counting = held?.party === party ? held : { since: now, party };
    session.campSeatedSince.set(camp.id, counting);
    if (now - counting.since < CAMP_REST_SEATED_MS) continue;

    for (const player of standing) {
      restoreResistance(
        player,
        CAMP_REST_RESISTANCE,
        PLAYER_MAX_RESISTANCE -
          progressionEffectTotal(
            player,
            "resistanceBonus",
            contentForSession(session),
          ),
      );
    }
    session.campsRested.add(camp.id);
    session.campSeatedSince.delete(camp.id);
  }
}
