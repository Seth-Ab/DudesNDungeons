import {
  ATTACK_STAMINA_COST,
  PLAYER_ATTACK_ARC_COS,
  PLAYER_ATTACK_COOLDOWN_MS,
  PLAYER_ATTACK_DAMAGE,
  PLAYER_ATTACK_RANGE,
} from "../../shared/constants/game.js";
import { distance, normalizeDirection } from "../../shared/game/movement.js";
import type { RejectionReason, ServerMessage } from "../../shared/protocol/index.js";
import type { EntityId, MonsterState, PlayerId, Vector2 } from "../../shared/types/core.js";
import type { Session } from "../sessions/sessionStore.js";
import { refreshExitSeals } from "./bosses.js";
import { isDown, monsterStatsFor } from "./dungeonState.js";
import { MonsterPlanner } from "./monsterAi.js";
import { dropMonsterLoot } from "./monsterLoot.js";
import { resolvePuzzles } from "./puzzles.js";
import { resolveTraps } from "./traps.js";
import { contentForSession, progressionEffectTotal } from "./progression.js";
import { advanceVitals, damagePlayer, spendStamina } from "./vitals.js";

export type AttackEvent = Extract<ServerMessage, { type: "attackResolved" }>;

export type AttackResult =
  | { ok: true; event: AttackEvent }
  | { ok: false; reason: RejectionReason };

/** Longest gap one simulation step covers, so a stalled timer cannot teleport monsters. */
const MAX_SIMULATION_STEP_MS = 250;

/** Closer than this, a monster is on top of the player, which counts as in front of any swing. */
const POINT_BLANK_DISTANCE = 1e-6;

/**
 * Resolves a melee swing. With `targetId`, that monster must be alive and in reach; without one, the
 * swing hits the nearest living monster in front of the player. A swing that hits nothing still
 * resolves and still costs the cooldown and the stamina, so swinging in every direction at once
 * gains nothing.
 *
 * Stamina is checked after reach and cooldown but charged only once the swing is going to happen,
 * so a refused swing never costs anything.
 */
export function resolvePlayerAttack(
  session: Session,
  playerId: PlayerId,
  direction: Vector2,
  targetId: EntityId | null,
  now: number,
): AttackResult {
  const player = session.players.get(playerId);
  if (session.location !== "dungeon" || !player || isDown(player)) {
    return { ok: false, reason: "notPermitted" };
  }

  const heading = normalizeDirection(direction);
  if (!heading) return { ok: false, reason: "outOfRange" };

  if (player.nextAttackAt !== null && now < player.nextAttackAt) {
    return { ok: false, reason: "onCooldown" };
  }

  const inReach = (monster: MonsterState): boolean => {
    const dx = monster.position.x - player.position.x;
    const dy = monster.position.y - player.position.y;
    const gap = Math.hypot(dx, dy);
    if (gap > PLAYER_ATTACK_RANGE) return false;
    return gap < POINT_BLANK_DISTANCE || (dx * heading.x + dy * heading.y) / gap >= PLAYER_ATTACK_ARC_COS;
  };

  let target: MonsterState | undefined;
  if (targetId === null) {
    target = session.dungeon.monsters
      .filter((monster) => monster.alive && inReach(monster))
      .sort(
        (a, b) => distance(a.position, player.position) - distance(b.position, player.position),
      )[0];
  } else {
    target = session.dungeon.monsters.find((monster) => monster.id === targetId && monster.alive);
    if (!target) return { ok: false, reason: "targetMissing" };
    if (!inReach(target)) return { ok: false, reason: "outOfRange" };
  }

  if (!spendStamina(player, ATTACK_STAMINA_COST)) {
    return { ok: false, reason: "exhausted" };
  }

  player.facing = heading;
  player.nextAttackAt = now + PLAYER_ATTACK_COOLDOWN_MS;

  if (!target) {
    return {
      ok: true,
      event: {
        type: "attackResolved",
        attackerId: player.id,
        targetId: null,
        damage: 0,
        targetHealth: 0,
        targetDefeated: false,
      },
    };
  }

  const damage =
    PLAYER_ATTACK_DAMAGE +
    progressionEffectTotal(player, "attackDamageBonus", contentForSession(session));
  const dealt = Math.min(damage, target.health);
  target.health -= dealt;
  target.alive = target.health > 0;
  // The last boss falling is what unseals the way out.
  if (target.boss && !target.alive) refreshExitSeals(session.dungeon);
  if (!target.alive) dropMonsterLoot(session, target);

  return {
    ok: true,
    event: {
      type: "attackResolved",
      attackerId: player.id,
      targetId: target.id,
      damage: dealt,
      targetHealth: target.health,
      targetDefeated: !target.alive,
    },
  };
}

/**
 * Advances dungeon-only simulation: vitals, monsters chasing, and monsters attacking. Downed
 * players stay down until Backend step 12 adds revival/carrying or the run returns to the hub.
 */
export function simulate(session: Session, now: number): AttackEvent[] {
  if (session.location !== "dungeon") return [];

  const elapsedMs =
    session.simulatedAt === null
      ? 0
      : Math.min(Math.max(now - session.simulatedAt, 0), MAX_SIMULATION_STEP_MS);
  session.simulatedAt = now;

  advanceVitals(session, now, elapsedMs);
  resolveTraps(session, now);
  resolvePuzzles(session, now);

  const events: AttackEvent[] = [];
  const planner = new MonsterPlanner(session);
  for (const monster of session.dungeon.monsters) {
    if (!monster.alive) continue;

    const event = actMonster(session, planner, monster, now, elapsedMs);
    if (event) events.push(event);
  }

  return events;
}

function actMonster(
  session: Session,
  planner: MonsterPlanner,
  monster: MonsterState,
  now: number,
  elapsedMs: number,
): AttackEvent | null {
  const stats = monsterStatsFor(monster);
  const stepDistance = (stats.speed * elapsedMs) / 1000;
  const target = planner.target(monster, stats, now);
  if (!target) {
    planner.returnHome(monster, now, stepDistance);
    return null;
  }

  if (distance(monster.position, target.position) > stats.attackRange) {
    planner.chase(monster, target.position, stepDistance);
    return null;
  }

  const readyAt = session.monsterCooldowns.get(monster.id) ?? now;
  if (now < readyAt) return null;

  session.monsterCooldowns.set(monster.id, now + stats.attackCooldownMs);
  // Resistance is applied inside damagePlayer, which is the only thing that lowers player health.
  const dealt = damagePlayer(target, stats.damage, contentForSession(session));

  return {
    type: "attackResolved",
    attackerId: monster.id,
    targetId: target.id,
    damage: dealt,
    targetHealth: target.health,
    targetDefeated: isDown(target),
  };
}
