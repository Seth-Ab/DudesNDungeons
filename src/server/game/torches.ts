import { INTERACT_RANGE } from "../../shared/constants/game.js";
import { distance } from "../../shared/game/movement.js";
import type { PlayerId } from "../../shared/types/core.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { noteTorchLit } from "./darkBargain.js";
import { isDown } from "./dungeonState.js";
import type { ItemResult } from "./items.js";

/**
 * Putting a carried torch out and lighting it again.
 *
 * A torch is out when `carryingTorch` holds and `torchLit` does not: it is still carried, but
 * `carriedTorchFor` in visibility gives no light for it. It relights only from another flame in
 * reach, so an unlit carrier has to find one.
 */

const OK: ItemResult = { ok: true };

function actor(session: Session, playerId: PlayerId): SessionPlayer | null {
  const player = session.players.get(playerId);
  return player && player.connected && !isDown(player) ? player : null;
}

/**
 * Whether another flame is in reach of this player: a fixed world light, or another player's lit
 * carried torch. A downed player's torch keeps burning where they fell, so it counts; a
 * disconnected player's goes out with them.
 */
export function flameInReach(session: Session, player: SessionPlayer): boolean {
  const reachable = (position: { x: number; y: number }) => distance(player.position, position) <= INTERACT_RANGE;

  if (session.dungeon.lightSources.some((light) => light.kind === "fixed" && reachable(light.position))) return true;

  for (const other of session.players.values()) {
    if (other.id === player.id || !other.connected) continue;
    if (other.carryingTorch && other.torchLit && reachable(other.position)) return true;
  }
  return false;
}

/** Puts out the sender's own lit torch. */
export function putOutTorch(session: Session, playerId: PlayerId): ItemResult {
  const player = actor(session, playerId);
  if (!player || !player.carryingTorch || !player.torchLit) return { ok: false, reason: "notPermitted" };

  player.torchLit = false;
  return OK;
}

/** Relights the sender's unlit torch from another flame within reach. */
export function lightTorch(session: Session, playerId: PlayerId): ItemResult {
  const player = actor(session, playerId);
  if (!player || !player.carryingTorch || player.torchLit) return { ok: false, reason: "notPermitted" };
  // A trap's soot holds the torch out until its wait is over, whatever flame is near.
  if (session.snuffedTorchUntil.has(player.id)) return { ok: false, reason: "notPermitted" };
  if (!flameInReach(session, player)) return { ok: false, reason: "outOfRange" };

  player.torchLit = true;
  noteTorchLit(session, player);
  return OK;
}
