import { distance } from "../../shared/game/movement.js";
import type { TrapState } from "../../shared/types/core.js";
import type { GameContent } from "../content/loadContent.js";
import type { TrapType } from "../content/schema.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { isDown } from "./dungeonState.js";
import { contentForSession } from "./progression.js";
import { damagePlayer, loseStamina, reduceResistance } from "./vitals.js";

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

function applyEffects(player: SessionPlayer, type: TrapType, content: GameContent): void {
  damagePlayer(player, type.damage, content);
  reduceResistance(player, type.resistanceLoss);
  loseStamina(player, type.staminaDrain);
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
    for (const victim of victims) applyEffects(victim, type, content);

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
