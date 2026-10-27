import {
  ATTACK_STAMINA_COST,
  PLAYER_ATTACK_ARC_COS,
  PLAYER_ATTACK_COOLDOWN_MS,
  PLAYER_ATTACK_DAMAGE,
  PLAYER_ATTACK_RANGE,
} from "../../shared/constants/game.js";
import { carriesIdol, distance, normalizeDirection } from "../../shared/game/movement.js";
import type { RejectionReason, ServerMessage } from "../../shared/protocol/index.js";
import type {
  DummyState,
  EntityId,
  MonsterState,
  PlayerId,
  Vector2,
} from "../../shared/types/core.js";
import type { GameContent } from "../content/loadContent.js";
import type { MeleeWeaponStats } from "../content/schema.js";
import type { Session, SessionPlayer } from "../sessions/sessionStore.js";
import { isDown, monsterStatsFor, type MonsterStats } from "./dungeonState.js";
import { recordDummyHit, refreshDummies } from "./dummies.js";
import { expireFlares } from "./flares.js";
import { MonsterPlanner } from "./monsterAi.js";
import { settleDraws } from "./bow.js";
import { standUp } from "./seats.js";
import { advanceCharge, advanceProjectiles, fireProjectile, startCharge } from "./monsterAttacks.js";
import { hasLineOfSight } from "./visibility.js";
import { damageMonster } from "./monsterDamage.js";
import { resolvePuzzles } from "./puzzles.js";
import { resolveTwinLocks } from "./twinLocks.js";
import { resolveIdols } from "./idols.js";
import { resolveTraps } from "./traps.js";
import { contentForSession, progressionEffectTotal } from "./progression.js";
import { advanceCamps } from "./camps.js";
import { advanceDarkBargains } from "./darkBargain.js";
import { advanceVitals, damagePlayer, markCombat, regenerateStamina, spendStamina } from "./vitals.js";

export type AttackEvent = Extract<ServerMessage, { type: "attackResolved" }>;

export type AttackResult =
  | { ok: true; event: AttackEvent }
  | { ok: false; reason: RejectionReason };

/** Longest gap one simulation step covers, so a stalled timer cannot teleport monsters. */
const MAX_SIMULATION_STEP_MS = 250;

/** Closer than this, a monster is on top of the player, which counts as in front of any swing. */
const POINT_BLANK_DISTANCE = 1e-6;

type SwingStats = Omit<MeleeWeaponStats, "kind">;

/** What a swing can land on: a monster, or a training dummy that takes the hit and nothing more. */
type SwingTarget = { kind: "monster"; entity: MonsterState } | { kind: "dummy"; entity: DummyState };

/** A swing with nothing in hand. */
const UNARMED_SWING: Readonly<SwingStats> = {
  damage: PLAYER_ATTACK_DAMAGE,
  range: PLAYER_ATTACK_RANGE,
  arcCos: PLAYER_ATTACK_ARC_COS,
  cooldownMs: PLAYER_ATTACK_COOLDOWN_MS,
  staminaCost: ATTACK_STAMINA_COST,
};

/**
 * The swing a player makes with what is in their hand, read from content at the moment of the
 * swing. Anything that is not a melee weapon whose definition still exists (an empty hand, a bow
 * before the bow issue, an id a content edit removed) swings unarmed.
 */
function swingFor(player: SessionPlayer, content: GameContent): Readonly<SwingStats> {
  const held = player.held;
  if (held?.kind !== "weapon") return UNARMED_SWING;

  const definition = content.items.get(held.itemId);
  if (definition?.kind !== "weapon" || definition.weapon.kind !== "melee") return UNARMED_SWING;
  return definition.weapon;
}

/**
 * Resolves a melee swing with the stats of the held weapon (see `swingFor`). With `targetId`, that
 * living monster or training dummy must be in reach; without one, the swing hits the nearest one in
 * front of the player. A swing that hits nothing still resolves and still costs the cooldown and
 * the stamina, so swinging in every direction at once gains nothing.
 *
 * Swinging is allowed in the hub as well as the dungeon. The hub has no monsters, only training
 * dummies: a hit on one reports the damage it would have done and feeds its readout (`dummies.ts`),
 * and the dummy itself is untouched.
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
  // An idol takes both hands: its carrier has to set it down to fight.
  if (!player || isDown(player) || carriesIdol(player)) return { ok: false, reason: "notPermitted" };

  const heading = normalizeDirection(direction);
  if (!heading) return { ok: false, reason: "outOfRange" };

  // Nobody swings from a bench: trying to stands them up first, and the swing goes from the floor.
  standUp(session, player);

  if (player.nextAttackAt !== null && now < player.nextAttackAt) {
    return { ok: false, reason: "onCooldown" };
  }

  const content = contentForSession(session);
  const swing = swingFor(player, content);
  const inReach = ({ entity }: SwingTarget): boolean => {
    const dx = entity.position.x - player.position.x;
    const dy = entity.position.y - player.position.y;
    const gap = Math.hypot(dx, dy);
    if (gap > swing.range) return false;
    return gap < POINT_BLANK_DISTANCE || (dx * heading.x + dy * heading.y) / gap >= swing.arcCos;
  };

  const candidates: SwingTarget[] = [
    ...session.dungeon.monsters
      .filter((monster) => monster.alive)
      .map((monster) => ({ kind: "monster" as const, entity: monster })),
    ...session.dungeon.dummies.map((dummy) => ({ kind: "dummy" as const, entity: dummy })),
  ];

  let target: SwingTarget | undefined;
  if (targetId === null) {
    target = candidates
      .filter(inReach)
      .sort(
        (a, b) =>
          distance(a.entity.position, player.position) - distance(b.entity.position, player.position),
      )[0];
  } else {
    target = candidates.find((candidate) => candidate.entity.id === targetId);
    if (!target) return { ok: false, reason: "targetMissing" };
    if (!inReach(target)) return { ok: false, reason: "outOfRange" };
  }

  if (!spendStamina(player, swing.staminaCost)) {
    return { ok: false, reason: "exhausted" };
  }

  player.facing = heading;
  player.nextAttackAt = now + swing.cooldownMs;
  const geometry = {
    origin: { x: player.position.x, y: player.position.y },
    facing: { x: heading.x, y: heading.y },
    range: swing.range,
    arcCos: swing.arcCos,
  };

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
        swing: geometry,
      },
    };
  }

  const damage = swing.damage + progressionEffectTotal(player, "attackDamageBonus", content);

  if (target.kind === "dummy") {
    // The full damage the hit would have done, since there is no health for it to be capped by.
    recordDummyHit(session, target.entity, player.id, damage, now);
    return {
      ok: true,
      event: {
        type: "attackResolved",
        attackerId: player.id,
        targetId: target.entity.id,
        damage,
        targetHealth: 0,
        targetDefeated: false,
        swing: geometry,
      },
    };
  }

  const monster = target.entity;
  const dealt = damageMonster(session, monster, damage);
  markCombat(player, now);

  return {
    ok: true,
    event: {
      type: "attackResolved",
      attackerId: player.id,
      targetId: monster.id,
      damage: dealt,
      targetHealth: monster.health,
      targetDefeated: !monster.alive,
      swing: geometry,
    },
  };
}

/**
 * Advances dungeon simulation: vitals, monsters chasing, and monsters attacking. Downed players
 * stay down until Backend step 12 adds revival/carrying or the run returns to the hub. In the hub
 * only stamina moves, so a player who swings there gets it back.
 */
export function simulate(session: Session, now: number): AttackEvent[] {
  const elapsedMs =
    session.simulatedAt === null
      ? 0
      : Math.min(Math.max(now - session.simulatedAt, 0), MAX_SIMULATION_STEP_MS);
  session.simulatedAt = now;
  // Before the hub returns early: a flare lit in the hub burns out there too, and the hub is where
  // the training dummies stand.
  expireFlares(session, now);
  refreshDummies(session, now);
  settleDraws(session, now);

  if (session.location !== "dungeon") {
    regenerateStamina(session, elapsedMs);
    // Arrows fly in the hub too, and hit the training dummies on the way.
    return advanceProjectiles(session, elapsedMs, now);
  }

  advanceVitals(session, now, elapsedMs);
  resolveTraps(session, now);
  // Before the puzzles, so an idol a carrier let go of lies on the floor for this tick's hold.
  resolveIdols(session);
  resolvePuzzles(session, now);
  resolveTwinLocks(session, now);
  advanceCamps(session, now);
  // Before the monsters act, so a wave the dark just sent already hunts this tick.
  advanceDarkBargains(session, now);

  const events: AttackEvent[] = [];
  const planner = new MonsterPlanner(session);
  for (const monster of session.dungeon.monsters) {
    if (!monster.alive) continue;

    events.push(...actMonster(session, planner, monster, now, elapsedMs));
  }
  events.push(...advanceProjectiles(session, elapsedMs, now));

  return events;
}

function actMonster(
  session: Session,
  planner: MonsterPlanner,
  monster: MonsterState,
  now: number,
  elapsedMs: number,
): AttackEvent[] {
  const stats = monsterStatsFor(monster);
  const startedAt = session.monsterWindups.get(monster.id);
  if (startedAt !== undefined) return resolveWindup(session, monster, stats, startedAt, now);

  const charge = session.monsterCharges.get(monster.id);
  if (charge) return advanceCharge(session, monster, stats, charge, now, elapsedMs);

  const stepDistance = (stats.speed * elapsedMs) / 1000;
  const target = planner.target(monster, stats, now);
  // A hurt elite calls for help, then runs. Cornered, it stands its ground and fights whoever
  // comes within reach, rather than stepping out of the corner and straight back into it.
  let cornered = false;
  if (planner.isFleeing(monster)) {
    planner.callNearby(monster, now);
    if (planner.flee(monster, stepDistance)) return [];
    if (!target) return [];
    cornered = true;
  }
  if (!target) {
    planner.returnHome(monster, now, stepDistance);
    return [];
  }

  const gap = distance(monster.position, target.position);
  if (stats.behavior === "ranged") {
    // Crowded, it backs off rather than closing; it only fires from a clear line.
    const preferred = stats.preferredRange ?? stats.attackRange;
    if (gap < preferred) planner.retreat(monster, target.position, stepDistance);
  }
  if (gap > stats.attackRange) {
    if (!cornered) planner.chase(monster, target.position, stepDistance);
    return [];
  }
  if (
    stats.behavior !== "melee" &&
    !hasLineOfSight(session.dungeon, monster.position, target.position)
  ) {
    planner.chase(monster, target.position, stepDistance);
    return [];
  }

  const readyAt = session.monsterCooldowns.get(monster.id) ?? now;
  if (now < readyAt) return [];

  const direction = normalizeDirection({
    x: target.position.x - monster.position.x,
    y: target.position.y - monster.position.y,
  });
  if (direction) monster.facing = direction;
  monster.action = "windingUp";
  monster.windupProgress = 0;
  session.monsterWindups.set(monster.id, now);
  return [];
}

/**
 * Advances a monster that is committed to a swing. It stands still until the wind-up elapses, then
 * hits every connected, standing player inside its reach and arc at that moment, so one who has
 * stepped out takes nothing. The cooldown starts here, at resolution.
 */
function resolveWindup(
  session: Session,
  monster: MonsterState,
  stats: MonsterStats,
  startedAt: number,
  now: number,
): AttackEvent[] {
  const progress = (now - startedAt) / stats.windupMs;
  if (progress < 1) {
    monster.windupProgress = Math.max(progress, 0);
    return [];
  }

  session.monsterWindups.delete(monster.id);
  session.monsterCooldowns.set(monster.id, now + stats.attackCooldownMs);
  monster.action = "idle";
  monster.windupProgress = 0;

  if (stats.behavior === "ranged") {
    fireProjectile(session, monster, stats);
    return [];
  }
  if (stats.behavior === "charger") {
    // The cooldown starts when the dash ends, not before it, so a long dash cannot pre-pay it.
    startCharge(session, monster);
    return [];
  }

  const reach = stats.hitRange ?? stats.attackRange;
  const content = contentForSession(session);
  const events: AttackEvent[] = [];
  for (const player of session.players.values()) {
    if (!player.connected || isDown(player)) continue;

    const gap = distance(monster.position, player.position);
    if (gap > reach) continue;
    if (gap > POINT_BLANK_DISTANCE) {
      const along =
        ((player.position.x - monster.position.x) * monster.facing.x +
          (player.position.y - monster.position.y) * monster.facing.y) /
        gap;
      if (along < stats.hitArcCos) continue;
    }

    // Resistance is applied inside damagePlayer, which is the only thing that lowers player health.
    const dealt = damagePlayer(player, stats.damage, content);
    markCombat(player, now);
    events.push({
      type: "attackResolved",
      attackerId: monster.id,
      targetId: player.id,
      damage: dealt,
      targetHealth: player.health,
      targetDefeated: isDown(player),
      swing: null,
    });
  }
  return events;
}
