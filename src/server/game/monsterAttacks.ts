import { randomUUID } from "node:crypto";
import { MAX_MOTION_SUBSTEP } from "../../shared/constants/game.js";
import { PLAYER_RADIUS, distance, isClosedDoorAt, isFloor, isOpen } from "../../shared/game/movement.js";
import type { ServerMessage } from "../../shared/protocol/index.js";
import type { EntityId, MonsterState, ProjectileState } from "../../shared/types/core.js";
import type { MonsterType } from "../content/schema.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { isDown } from "./dungeonState.js";
import { recordDummyHit } from "./dummies.js";
import { damageMonster } from "./monsterDamage.js";
import { contentForSession } from "./progression.js";
import { damagePlayer } from "./vitals.js";

type AttackEvent = Extract<ServerMessage, { type: "attackResolved" }>;

/**
 * What the server knows about a bolt in flight that a client has no business seeing. A bolt whose
 * `ownerId` is a player in the session is an arrow: it passes through the party and strikes
 * monsters and training dummies instead.
 */
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
    swing: null,
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
 * Flies every bolt for one step, in sub-steps shorter than a body so none passes through a body or a
 * wall. A bolt ends on the first thing it meets: a wall or closed door, the first body of the other
 * side on its path (a monster's bolt meets players, which is how one player body-blocks for
 * another; a player's arrow meets monsters and training dummies and never a party member), or the
 * end of its range.
 */
export function advanceProjectiles(session: Session, elapsedMs: number, now: number): AttackEvent[] {
  const events: AttackEvent[] = [];
  const players = standingTargets(session);
  const survivors: ProjectileState[] = [];

  for (const bolt of session.dungeon.projectiles) {
    const run = session.projectileRuns.get(bolt.id);
    if (!run) continue;

    const fromPlayer = session.players.has(run.ownerId);
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

      if (fromPlayer) {
        const event = strikeWithArrow(session, bolt, run, now);
        if (event) {
          events.push(event);
          spent = true;
        }
        continue;
      }

      let struck: SessionPlayer | undefined;
      let struckGap = PLAYER_RADIUS + bolt.radius;
      for (const player of players) {
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

/**
 * What a player's arrow has reached at its current position, if anything: the nearest living
 * monster or training dummy within a body's reach of it. A monster takes the damage through the
 * same path a sword uses; a dummy logs what the hit would have done and is otherwise untouched.
 */
function strikeWithArrow(
  session: Session,
  arrow: ProjectileState,
  run: ProjectileRun,
  now: number,
): AttackEvent | null {
  const reach = PLAYER_RADIUS + arrow.radius;
  const monster = nearest(
    session.dungeon.monsters.filter((candidate) => candidate.alive),
    arrow.position,
  );
  const dummy = nearest(session.dungeon.dummies, arrow.position);
  const monsterGap = monster ? distance(monster.position, arrow.position) : Infinity;
  const dummyGap = dummy ? distance(dummy.position, arrow.position) : Infinity;
  if (Math.min(monsterGap, dummyGap) > reach) return null;

  if (monster && monsterGap <= dummyGap) {
    const dealt = damageMonster(session, monster, run.damage);
    return {
      type: "attackResolved",
      attackerId: run.ownerId,
      targetId: monster.id,
      damage: dealt,
      targetHealth: monster.health,
      targetDefeated: !monster.alive,
      swing: null,
    };
  }

  if (!dummy) return null;
  recordDummyHit(session, dummy, run.ownerId, run.damage, now);
  return {
    type: "attackResolved",
    attackerId: run.ownerId,
    targetId: dummy.id,
    damage: run.damage,
    targetHealth: 0,
    targetDefeated: false,
    swing: null,
  };
}

function nearest<T extends { position: { x: number; y: number } }>(
  bodies: readonly T[],
  from: { x: number; y: number },
): T | undefined {
  let best: T | undefined;
  let bestGap = Infinity;
  for (const body of bodies) {
    const gap = distance(body.position, from);
    if (gap < bestGap) {
      best = body;
      bestGap = gap;
    }
  }
  return best;
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
