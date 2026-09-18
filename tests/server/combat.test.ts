import { describe, expect, it } from "vitest";
import { resolvePlayerAttack, simulate } from "../../src/server/game/combat.js";
import { canOccupy, monsterStatsFor } from "../../src/server/game/dungeonState.js";
import {
  PLAYER_ATTACK_COOLDOWN_MS,
  PLAYER_ATTACK_DAMAGE,
  PLAYER_MAX_HEALTH,
  PLAYER_RESPAWN_MS,
} from "../../src/shared/constants/game.js";
import { at, ASH_IMP_ID, monster, testPlayer, testSession } from "./fixtures.js";

// The Ash Imp starts on authored tile (11, 2) with 12 health.

/**
 * How far west of the imp a player stands to be able to hit it, and be hit back.
 *
 * Reach is a body's length and does not scale with the map, so it is written in world units rather
 * than in tiles: inside `PLAYER_ATTACK_RANGE` and inside the imp's own shorter `attackRange`, but
 * outside the radius where two bodies count as overlapping.
 */
const IN_REACH = 0.9;

describe("player attacks", () => {
  it("hits the monster in front of the player", () => {
    const session = testSession([testPlayer("alpha", { position: at(11, 2, -IN_REACH) })]);

    const result = resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 0);

    expect(result).toEqual({
      ok: true,
      event: {
        type: "attackResolved",
        attackerId: "alpha",
        targetId: ASH_IMP_ID,
        damage: PLAYER_ATTACK_DAMAGE,
        targetHealth: 12 - PLAYER_ATTACK_DAMAGE,
        targetDefeated: false,
      },
    });
    expect(monster(session, ASH_IMP_ID).health).toBe(12 - PLAYER_ATTACK_DAMAGE);
  });

  it("swings at nothing when the monster is behind, which still costs the cooldown", () => {
    const session = testSession([testPlayer("alpha", { position: at(11, 2, -IN_REACH) })]);

    const swing = resolvePlayerAttack(session, "alpha", { x: -1, y: 0 }, null, 0);

    expect(swing.ok && swing.event.targetId).toBeNull();
    expect(monster(session, ASH_IMP_ID).health).toBe(12);
    expect(resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 1)).toEqual({
      ok: false,
      reason: "onCooldown",
    });
  });

  it("refuses a second swing until the cooldown passes", () => {
    const session = testSession([testPlayer("alpha", { position: at(11, 2, -IN_REACH) })]);

    expect(resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 0).ok).toBe(true);
    expect(
      resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, PLAYER_ATTACK_COOLDOWN_MS - 1),
    ).toEqual({ ok: false, reason: "onCooldown" });
    expect(
      resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, PLAYER_ATTACK_COOLDOWN_MS).ok,
    ).toBe(true);
  });

  it("refuses a named target that is out of reach or already dead", () => {
    const session = testSession([testPlayer("alpha", { position: at(2, 2) })]);

    expect(resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, ASH_IMP_ID, 0)).toEqual({
      ok: false,
      reason: "outOfRange",
    });

    monster(session, ASH_IMP_ID).alive = false;

    expect(resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, ASH_IMP_ID, 0)).toEqual({
      ok: false,
      reason: "targetMissing",
    });
  });

  it("defeats a monster, which then stops blocking the way", () => {
    const session = testSession([testPlayer("alpha", { position: at(11, 2, -IN_REACH) })]);
    const imp = monster(session, ASH_IMP_ID);
    imp.health = PLAYER_ATTACK_DAMAGE - 1;

    const result = resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 0);

    expect(result.ok && result.event).toMatchObject({
      damage: PLAYER_ATTACK_DAMAGE - 1,
      targetHealth: 0,
      targetDefeated: true,
    });
    expect(imp.alive).toBe(false);
    expect(canOccupy(session, imp.position)).toBe(true);
  });

  it("does not let a downed player attack", () => {
    const session = testSession([
      testPlayer("alpha", { position: at(11, 2, -IN_REACH), health: 0 }),
    ]);

    expect(resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 0)).toEqual({
      ok: false,
      reason: "notPermitted",
    });
  });
});

describe("monster behavior", () => {
  const impStats = () => monsterStatsFor(monster(testSession([]), ASH_IMP_ID));

  it("chases a player inside its aggro range", () => {
    const session = testSession([testPlayer("alpha", { position: at(8, 1) })]);

    simulate(session, 0);
    simulate(session, 100);

    const imp = monster(session, ASH_IMP_ID);
    const start = at(11, 2);
    const travelled = Math.hypot(imp.position.x - start.x, imp.position.y - start.y);
    expect(travelled).toBeCloseTo(impStats().speed * 0.1);
    expect(imp.position.x).toBeLessThan(start.x);
  });

  it("ignores players out of range and players who are disconnected", () => {
    const far = testSession([testPlayer("alpha", { position: at(2, 2) })]);
    const dropped = testSession([testPlayer("alpha", { position: at(9, 2), connected: false })]);

    for (const session of [far, dropped]) {
      simulate(session, 0);
      simulate(session, 100);
      expect(monster(session, ASH_IMP_ID).position).toEqual(at(11, 2));
    }
  });

  it("attacks a player in reach, no faster than its cooldown", () => {
    // Zero resistance, so this test measures the monster's cooldown rather than damage reduction.
    const player = testPlayer("alpha", { position: at(11, 2, -IN_REACH), resistance: 0 });
    const session = testSession([player]);
    const { damage, attackCooldownMs } = impStats();
    const impHits = (now: number) =>
      simulate(session, now).filter((event) => event.attackerId === ASH_IMP_ID);

    expect(impHits(0)).toEqual([
      {
        type: "attackResolved",
        attackerId: ASH_IMP_ID,
        targetId: "alpha",
        damage,
        targetHealth: PLAYER_MAX_HEALTH - damage,
        targetDefeated: false,
      },
    ]);
    expect(impHits(attackCooldownMs - 1)).toEqual([]);
    expect(impHits(attackCooldownMs)).toHaveLength(1);
    expect(player.health).toBe(PLAYER_MAX_HEALTH - 2 * damage);
  });

  it("reports the damage resistance actually let through", () => {
    const player = testPlayer("alpha", { position: at(11, 2, -IN_REACH), resistance: 100 });
    const session = testSession([player]);
    const { damage } = impStats();

    const [hit] = simulate(session, 0).filter((event) => event.attackerId === ASH_IMP_ID);

    // 100 resistance halves the hit, and the event reports what landed, not what was swung.
    expect(hit).toMatchObject({ damage: damage / 2, targetHealth: PLAYER_MAX_HEALTH - damage / 2 });
    expect(player.health).toBe(PLAYER_MAX_HEALTH - damage / 2);
  });

  it("closes to attack range without walking into the player", () => {
    const stand = at(8, 1);
    const player = testPlayer("alpha", { position: stand });
    const session = testSession([player]);

    // Long enough for the imp to cross the room it now has to cross.
    for (let now = 0; now <= 6000; now += 50) simulate(session, now);

    const imp = monster(session, ASH_IMP_ID);
    const gap = Math.hypot(imp.position.x - stand.x, imp.position.y - stand.y);
    expect(gap).toBeLessThanOrEqual(impStats().attackRange);
    expect(gap).toBeGreaterThanOrEqual(0.7);
    expect(player.health).toBeLessThan(PLAYER_MAX_HEALTH);
  });

  it("downs a player, leaves them alone, and respawns them with full health", () => {
    const player = testPlayer("alpha", { position: at(11, 2, -IN_REACH), health: 1, resistance: 0 });
    const session = testSession([player]);

    const [hit] = simulate(session, 0);

    expect(hit).toMatchObject({ targetId: "alpha", damage: 1, targetHealth: 0, targetDefeated: true });
    expect(player.respawnAt).toBe(PLAYER_RESPAWN_MS);

    expect(simulate(session, PLAYER_RESPAWN_MS - 1)).toEqual([]);
    expect(player.health).toBe(0);

    simulate(session, PLAYER_RESPAWN_MS);

    expect(player.health).toBe(PLAYER_MAX_HEALTH);
    expect(player.position).toEqual(at(2, 2));
    expect(player.respawnAt).toBeNull();
  });
});
