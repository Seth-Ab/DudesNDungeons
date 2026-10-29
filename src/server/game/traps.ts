import { distance } from "../../shared/game/movement.js";
import type { TrapState } from "../../shared/types/core.js";
import type { GameContent } from "../content/loadContent.js";
import type { TrapType } from "../content/schema.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { isDown } from "./dungeonState.js";
import { contentForSession } from "./progression.js";
import { noteTorchLit } from "./darkBargain.js";
import { damagePlayer, loseStamina, markCombat, reduceResistance } from "./vitals.js";

/**
 * Server-resolved traps.
 *
 * A trap is evaluated only here, from the server's own view of where players stand: the client
 * sends movement intent and never says it stepped on anything. Every effect goes through the shared
 * vitals helpers, so damage is still scaled by resistance and a trap cannot invent a second way to
 * lower health.
 */

function trapTypeFor(trap: TrapState, content: GameContent): TrapType {
  const type = content.traps.get(trap.typeId);
  if (!type) throw new Error(`No trap type "${trap.typeId}"`);
  return type;
}

/**
 * Standing, connected players in reach. Downed players are inert bodies and a disconnected player
 * is not hunted, the same rule monsters follow: a dropped connection should not come back to a trap
 * that fired on someone who was not there to react.
 */
function victimsOf(session: Session, trap: TrapState): SessionPlayer[] {
  return [...session.players.values()].filter(
    (player) =>
      player.connected && !isDown(player) && distance(player.position, trap.position) <= trap.radius,
  );
}

function applyEffects(player: SessionPlayer, type: TrapType, content: GameContent, now: number): void {
  if (damagePlayer(player, type.damage, content) > 0) markCombat(player, now);
  reduceResistance(player, type.resistanceLoss);
  loseStamina(player, type.staminaDrain);
}

/**
 * Puts out every held torch and flare within the trap's radius for `type.effectMs`.
 *
 * A torch goes out through the player's own unlit state, so a torch someone had already put out is
 * not recorded and stays out when the wait ends. A snuffed flare is hidden from visibility and its
 * burn-out time moves back by the wait, so the vent does not spend it. A downed player's torch burns
 * where they fell and is snuffed too; a disconnected player's is not lit for anyone already.
 */
function snuff(session: Session, trap: TrapState, type: TrapType, now: number): void {
  const until = now + (type.effectMs ?? 0);
  const inReach = (position: { x: number; y: number }) => distance(position, trap.position) <= trap.radius;

  for (const player of session.players.values()) {
    if (!player.connected || !player.carryingTorch || !inReach(player.position)) continue;
    if (player.torchLit) {
      player.torchLit = false;
      session.snuffedTorchUntil.set(player.id, until);
    } else if (session.snuffedTorchUntil.has(player.id)) {
      session.snuffedTorchUntil.set(player.id, until);
    }
  }

  for (const light of session.dungeon.lightSources) {
    if (light.kind !== "flare" || !inReach(light.position)) continue;
    const snuffedUntil = session.snuffedFlareUntil.get(light.id);
    const waitFrom = snuffedUntil === undefined ? now : Math.max(now, snuffedUntil);
    const extension = Math.max(0, until - waitFrom);
    session.snuffedFlareUntil.set(light.id, Math.max(until, snuffedUntil ?? 0));
    const burnsOutAt = session.flareExpiresAt.get(light.id);
    if (burnsOutAt !== undefined) session.flareExpiresAt.set(light.id, burnsOutAt + extension);
  }
}

/** Relights what a trap snuffed once its wait is over, leaving a torch the player put out unlit. */
function relightSnuffed(session: Session, now: number): void {
  for (const [playerId, until] of session.snuffedTorchUntil) {
    if (now < until) continue;
    session.snuffedTorchUntil.delete(playerId);
    const player = session.players.get(playerId);
    if (!player || !player.carryingTorch || player.torchLit) continue;
    player.torchLit = true;
    noteTorchLit(session, player);
  }
  for (const [lightId, until] of session.snuffedFlareUntil) {
    if (now >= until) session.snuffedFlareUntil.delete(lightId);
  }
}

/**
 * Rearms what is due, then fires every armed trap with someone in reach. Returns the traps that
 * fired, so a caller or test can see what this step did.
 *
 * A rearming trap waits until its footprint is empty, so standing on one is one hit per exit and
 * re-entry rather than a hit every cooldown.
 */
export function resolveTraps(session: Session, now: number): TrapState[] {
  if (session.location !== "dungeon") return [];

  const content = contentForSession(session);
  const fired: TrapState[] = [];
  relightSnuffed(session, now);

  for (const trap of session.dungeon.traps) {
    if (trap.phase === "triggered") {
      const rearmAt = session.trapRearmAt.get(trap.id);
      if (rearmAt !== undefined && now >= rearmAt && victimsOf(session, trap).length === 0) {
        trap.phase = "armed";
        session.trapRearmAt.delete(trap.id);
      }
      continue;
    }
    if (trap.phase !== "armed") continue;

    const victims = victimsOf(session, trap);
    if (victims.length === 0) continue;

    const type = trapTypeFor(trap, content);
    for (const victim of victims) applyEffects(victim, type, content, now);
    if (type.effect === "snuffTorch") snuff(session, trap, type, now);

    if (type.rearmMs === undefined) {
      trap.phase = "disabled";
    } else {
      trap.phase = "triggered";
      session.trapRearmAt.set(trap.id, now + type.rearmMs);
    }
    fired.push(trap);
  }

  return fired;
}
