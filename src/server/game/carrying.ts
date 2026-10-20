import { INTERACT_RANGE, LIFT_STAMINA_COST } from "../../shared/constants/game.js";
import { distance } from "../../shared/game/movement.js";
import type { RejectionReason } from "../../shared/protocol/index.js";
import type { PlayerId } from "../../shared/types/core.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { isDown } from "./dungeonState.js";
import { standUp } from "./seats.js";
import { spendStamina } from "./vitals.js";

export type CarryResult = { ok: true } | { ok: false; reason: RejectionReason };

const OK: CarryResult = { ok: true };

function reject(reason: RejectionReason): CarryResult {
  return { ok: false, reason };
}

/** Standing, and not already on either side of a carry. */
function eligibleCarrier(session: Session, playerId: PlayerId): SessionPlayer | null {
  const player = session.players.get(playerId);
  if (!player || isDown(player)) return null;
  if (player.carryingPlayerId !== null || player.carriedByPlayerId !== null) return null;
  return player;
}

/**
 * Lifts a downed party member within reach, spending `LIFT_STAMINA_COST`.
 *
 * One carrier per target and one target per carrier: a player already carrying or being carried
 * cannot lift, and a downed player already claimed by someone else cannot be lifted a second time.
 * That ownership is what makes contention resolve to exactly one winner rather than two carriers
 * silently sharing one body.
 */
export function liftPlayer(
  session: Session,
  playerId: PlayerId,
  targetPlayerId: PlayerId,
): CarryResult {
  if (playerId === targetPlayerId) return reject("notPermitted");

  const player = eligibleCarrier(session, playerId);
  if (!player) return reject("notPermitted");

  const target = session.players.get(targetPlayerId);
  if (!target) return reject("targetMissing");
  if (!isDown(target)) return reject("notPermitted");
  if (target.carriedByPlayerId !== null) return reject("notPermitted");

  if (distance(player.position, target.position) > INTERACT_RANGE) return reject("outOfRange");
  if (!spendStamina(player, LIFT_STAMINA_COST)) return reject("exhausted");

  // Lifting is done standing, and a body lifted off a seat goes where its carrier is.
  standUp(session, player);
  target.seatId = null;
  player.carryingPlayerId = target.id;
  target.carriedByPlayerId = player.id;
  target.position = { ...player.position };
  return OK;
}

/** Explicitly sets down whoever this player is carrying. The target stays exactly where it was. */
export function dropCarry(session: Session, playerId: PlayerId): CarryResult {
  const player = session.players.get(playerId);
  if (!player || player.carryingPlayerId === null) return reject("notPermitted");

  const target = session.players.get(player.carryingPlayerId);
  if (target) target.carriedByPlayerId = null;
  player.carryingPlayerId = null;
  return OK;
}
