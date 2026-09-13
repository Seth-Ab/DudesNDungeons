import { describe, expect, it } from "vitest";
import { resolvePlayerAttack, simulate } from "../../src/server/game/combat.js";
import { canOccupy, monsterStatsFor } from "../../src/server/game/dungeonState.js";
import {
  PLAYER_ATTACK_COOLDOWN_MS,
  PLAYER_ATTACK_DAMAGE,
  PLAYER_MAX_HEALTH,
  PLAYER_RESPAWN_MS,
} from "../../src/shared/constants/game.js";
import { ASH_IMP_ID, monster, testPlayer, testSession } from "./fixtures.js";

// The Ash Imp starts at (11, 2) with 12 health.

describe("player attacks", () => {
  it("hits the monster in front of the player", () => {
    const session = testSession([testPlayer("alpha", { position: { x: 10, y: 2 } })]);

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
    const session = testSession([testPlayer("alpha", { position: { x: 10, y: 2 } })]);

    const swing = resolvePlayerAttack(session, "alpha", { x: -1, y: 0 }, null, 0);

    expect(swing.ok && swing.event.targetId).toBeNull();
    expect(monster(session, ASH_IMP_ID).health).toBe(12);
    expect(resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 1)).toEqual({
      ok: false,
      reason: "onCooldown",
    });
  });

  it("refuses a second swing until the cooldown passes", () => {
    const session = testSession([testPlayer("alpha", { position: { x: 10, y: 2 } })]);

    expect(resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 0).ok).toBe(true);
    expect(
      resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, PLAYER_ATTACK_COOLDOWN_MS - 1),
    ).toEqual({ ok: false, reason: "onCooldown" });
    expect(
      resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, PLAYER_ATTACK_COOLDOWN_MS).ok,
    ).toBe(true);
  });

  it("refuses a named target that is out of reach or already dead", () => {
    const session = testSession([testPlayer("alpha", { position: { x: 2, y: 2 } })]);

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
    const session = testSession([testPlayer("alpha", { position: { x: 10, y: 2 } })]);
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
    const session = testSession([testPlayer("alpha", { position: { x: 10, y: 2 }, health: 0 })]);

    expect(resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 0)).toEqual({
      ok: false,
      reason: "notPermitted",
    });
  });
});

describe("monster behavior", () => {
  const impStats = () => monsterStatsFor(monster(testSession([]), ASH_IMP_ID));

  it("chases a player inside its aggro range", () => {
    const session = testSession([testPlayer("alpha", { position: { x: 8, y: 1 } })]);

    simulate(session, 0);
    simulate(session, 100);

    const imp = monster(session, ASH_IMP_ID);
    const travelled = Math.hypot(imp.position.x - 11, imp.position.y - 2);
    expect(travelled).toBeCloseTo(impStats().speed * 0.1);
    expect(imp.position.x).toBeLessThan(11);
  });

  it("ignores players out of range and players who are disconnected", () => {
    const far = testSession([testPlayer("alpha", { position: { x: 2, y: 2 } })]);
    const dropped = testSession([
      testPlayer("alpha", { position: { x: 9, y: 2 }, connected: false }),
    ]);

    for (const session of [far, dropped]) {
      simulate(session, 0);
      simulate(session, 100);
      expect(monster(session, ASH_IMP_ID).position).toEqual({ x: 11, y: 2 });
    }
  });

  it("attacks a player in reach, no faster than its cooldown", () => {
    const player = testPlayer("alpha", { position: { x: 10, y: 2 } });
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

  it("closes to attack range without walking into the player", () => {
    const player = testPlayer("alpha", { position: { x: 8, y: 1 } });
    const session = testSession([player]);

    for (let now = 0; now <= 3000; now += 50) simulate(session, now);

    const imp = monster(session, ASH_IMP_ID);
    const gap = Math.hypot(imp.position.x - 8, imp.position.y - 1);
    expect(gap).toBeLessThanOrEqual(impStats().attackRange);
    expect(gap).toBeGreaterThanOrEqual(0.7);
    expect(player.health).toBeLessThan(PLAYER_MAX_HEALTH);
  });

  it("downs a player, leaves them alone, and respawns them with full health", () => {
    const player = testPlayer("alpha", { position: { x: 10, y: 2 }, health: 1 });
    const session = testSession([player]);

    const [hit] = simulate(session, 0);

    expect(hit).toMatchObject({ targetId: "alpha", damage: 1, targetHealth: 0, targetDefeated: true });
    expect(player.respawnAt).toBe(PLAYER_RESPAWN_MS);

    expect(simulate(session, PLAYER_RESPAWN_MS - 1)).toEqual([]);
    expect(player.health).toBe(0);

    simulate(session, PLAYER_RESPAWN_MS);

    expect(player.health).toBe(PLAYER_MAX_HEALTH);
    expect(player.position).toEqual({ x: 2, y: 2 });
    expect(player.respawnAt).toBeNull();
  });
});
