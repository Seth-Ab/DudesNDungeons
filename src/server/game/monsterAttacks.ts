import { randomUUID } from "node:crypto";
import { MAX_MOTION_SUBSTEP } from "../../shared/constants/game.js";
import { PLAYER_RADIUS, distance, isClosedDoorAt, isFloor, isOpen } from "../../shared/game/movement.js";
import type { ServerMessage } from "../../shared/protocol/index.js";
import type { EntityId, MonsterState, ProjectileState } from "../../shared/types/core.js";
import type { MonsterType } from "../content/schema.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { isDown } from "./dungeonState.js";
import { contentForSession } from "./progression.js";
import { damagePlayer } from "./vitals.js";

type AttackEvent = Extract<ServerMessage, { type: "attackResolved" }>;

/** What the server knows about a bolt in flight that a client has no business seeing. */
export interface ProjectileRun {
  ownerId: EntityId;
  damage: number;
  speed: number;
  /** World units it may still fly before it fizzles out. */
  remaining: number;
}

/** One dash in progress. `stunnedUntil` is set once it hits a wall and ends the dash. */
export interface ChargeRun {
  travelled: number;
  stunnedUntil: number | null;
}

/** A charger hits a player it touches: two bodies, with a little give so a graze counts. */
const CHARGE_CONTACT_RANGE = PLAYER_RADIUS * 2 + 0.1;

function standingTargets(session: Session): SessionPlayer[] {
  return [...session.players.values()].filter((player) => player.connected && !isDown(player));
}

function hitPlayer(
  session: Session,
  attackerId: EntityId,
  player: SessionPlayer,
  damage: number,
): AttackEvent {
  // Resistance is applied inside damagePlayer, which is the only thing that lowers player health.
  const dealt = damagePlayer(player, damage, contentForSession(session));
  return {
    type: "attackResolved",
    attackerId,
    targetId: player.id,
    damage: dealt,
    targetHealth: player.health,
    targetDefeated: isDown(player),
  };
}

/** Looses a bolt from the monster along its wind-up facing. */
export function fireProjectile(session: Session, monster: MonsterState, stats: MonsterType): void {
  const bolt = stats.projectile;
  if (!bolt) return;

  const id = randomUUID();
  session.dungeon.projectiles.push({
    id,
    position: { ...monster.position },
    direction: { ...monster.facing },
    radius: bolt.radius,
  });
  session.projectileRuns.set(id, {
    ownerId: monster.id,
    damage: bolt.damage,
    speed: bolt.speed,
    remaining: bolt.range,
  });
}

/**
 * Flies every bolt for one step, in sub-steps shorter than a body so none passes through a player
 * or a wall. A bolt ends on the first thing it meets: a wall or closed door, the first player on its
 * path (which is how one player body-blocks for another), or the end of its range.
 */
export function advanceProjectiles(session: Session, elapsedMs: number): AttackEvent[] {
  const events: AttackEvent[] = [];
  const targets = standingTargets(session);
  const survivors: ProjectileState[] = [];

  for (const bolt of session.dungeon.projectiles) {
    const run = session.projectileRuns.get(bolt.id);
    if (!run) continue;

    let travel = Math.min((run.speed * elapsedMs) / 1000, run.remaining);
    let spent = false;
    while (travel > 0 && !spent) {
      const length = Math.min(travel, MAX_MOTION_SUBSTEP);
      travel -= length;
      run.remaining -= length;
      bolt.position = {
        x: bolt.position.x + bolt.direction.x * length,
        y: bolt.position.y + bolt.direction.y * length,
      };

      if (!isFloor(session.dungeon, bolt.position) || isClosedDoorAt(session.dungeon, bolt.position)) {
        spent = true;
        break;
      }

      let struck: SessionPlayer | undefined;
      let struckGap = PLAYER_RADIUS + bolt.radius;
      for (const player of targets) {
        const gap = distance(bolt.position, player.position);
        if (gap <= struckGap) {
          struck = player;
          struckGap = gap;
        }
      }
      if (struck) {
        events.push(hitPlayer(session, run.ownerId, struck, run.damage));
        spent = true;
      }
    }

    if (spent || run.remaining <= 0) {
      session.projectileRuns.delete(bolt.id);
    } else {
      survivors.push(bolt);
    }
  }

  session.dungeon.projectiles = survivors;
  return events;
}

/** Commits the monster to a dash along its wind-up facing. */
export function startCharge(session: Session, monster: MonsterState): void {
  monster.action = "charging";
  monster.windupProgress = 0;
  session.monsterCharges.set(monster.id, { travelled: 0, stunnedUntil: null });
}

/**
 * Moves a dashing or stunned monster. The dash goes straight, never steering: it ends at its full
 * distance, on touching a player (who takes the hit), or on a wall, which stuns the monster for
 * `charge.stunMs`. A stunned monster does nothing, then its attack cooldown starts.
 */
export function advanceCharge(
  session: Session,
  monster: MonsterState,
  stats: MonsterType,
  run: ChargeRun,
  now: number,
  elapsedMs: number,
): AttackEvent[] {
  const charge = stats.charge;
  const finish = (): void => {
    session.monsterCharges.delete(monster.id);
    session.monsterCooldowns.set(monster.id, now + stats.attackCooldownMs);
    monster.action = "idle";
  };
  if (!charge) {
    finish();
    return [];
  }

  if (run.stunnedUntil !== null) {
    if (now >= run.stunnedUntil) finish();
    return [];
  }

  const targets = standingTargets(session);
  let travel = Math.min((charge.speed * elapsedMs) / 1000, charge.distance - run.travelled);
  while (travel > 0) {
    const length = Math.min(travel, MAX_MOTION_SUBSTEP);
    travel -= length;
    const next = {
      x: monster.position.x + monster.facing.x * length,
      y: monster.position.y + monster.facing.y * length,
    };

    const touched = targets.find((player) => distance(next, player.position) <= CHARGE_CONTACT_RANGE);
    if (touched) {
      finish();
      return [hitPlayer(session, monster.id, touched, stats.damage)];
    }

    if (!isOpen(session.dungeon, [], next, undefined, monster)) {
      monster.action = "stunned";
      run.stunnedUntil = now + charge.stunMs;
      return [];
    }

    monster.position = next;
    run.travelled += length;
  }

  if (run.travelled >= charge.distance) finish();
  return [];
}
