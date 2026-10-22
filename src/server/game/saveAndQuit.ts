import { SAVE_QUIT_COMBAT_GRACE_MS } from "../../shared/constants/game.js";
import { distance } from "../../shared/game/movement.js";
import type { RejectionReason } from "../../shared/protocol/index.js";
import type { PlayerId } from "../../shared/types/core.js";
import { saveRoom } from "../saves/roomSaving.js";
import type { SessionMember, SessionPlayer, Session, SessionStore } from "../sessions/sessionStore.js";
import { isDown, isSpawned, monsterStatsFor } from "./dungeonState.js";

export type SaveAndQuitResult =
  | { ok: true; member: SessionMember }
  | { ok: false; reason: RejectionReason };

/**
 * True while a monster is winding up or dashing with this player inside its reach. The server does
 * not name a target for either, so reach is the test: a wind-up swings at whoever is in range when
 * it lands, and a dash covers its full distance from where it stands.
 */
function monsterClosingOn(session: Session, player: SessionPlayer): boolean {
  for (const monster of session.dungeon.monsters) {
    if (!monster.alive) continue;

    const charge = session.monsterCharges.get(monster.id);
    const windingUp = session.monsterWindups.has(monster.id);
    // A stunned charger has spent its dash.
    if (!windingUp && (!charge || charge.stunnedUntil !== null)) continue;

    const stats = monsterStatsFor(monster);
    const reach = Math.max(stats.hitRange ?? stats.attackRange, stats.charge?.distance ?? 0);
    if (distance(monster.position, player.position) <= reach) return true;
  }
  return false;
}

/** Why this player may not save and quit right now, or null when they may. */
export function saveAndQuitRefusal(session: Session, player: SessionPlayer, now: number): RejectionReason | null {
  if (session.location !== "dungeon" || !isSpawned(player)) return "notPermitted";
  // A save can't be used to escape death, so a downed player, or one being carried out, stays put.
  if (isDown(player) || player.carriedByPlayerId !== null) return "notPermitted";

  if (player.lastCombatAt !== null && now - player.lastCombatAt < SAVE_QUIT_COMBAT_GRACE_MS) return "inCombat";
  if (monsterClosingOn(session, player)) return "inCombat";
  return null;
}

/**
 * A deliberate Save and quit: writes the room with this player's carry and position, then takes
 * them out of the live world without the loss `leave` implies. Later saves keep their entry (they
 * are an absent member) until the run ends. A refusal changes nothing.
 */
export function saveAndQuit(
  store: SessionStore,
  playerId: PlayerId,
  now: number,
  wallNow: number,
): SaveAndQuitResult {
  const member = store.findMember(playerId);
  if (!member) return { ok: false, reason: "notPermitted" };

  const refusal = saveAndQuitRefusal(member.session, member.player, now);
  if (refusal) return { ok: false, reason: refusal };

  // Saved while they are still in the session, so their entry is captured live; once they are gone
  // the store only carries it forward.
  saveRoom(member.session, store.saves, now, wallNow);
  store.leave(playerId);
  return { ok: true, member };
}
