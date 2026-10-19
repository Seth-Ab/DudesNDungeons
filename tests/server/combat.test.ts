import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import type { ItemDefinition, SkillDefinition } from "../../src/server/content/schema.js";
import { resolvePlayerAttack, simulate } from "../../src/server/game/combat.js";
import { canOccupy, HUB_DUNGEON_ID, monsterStatsFor } from "../../src/server/game/dungeonState.js";
import { pickupItem } from "../../src/server/game/items.js";
import {
  ATTACK_STAMINA_COST,
  PLAYER_ATTACK_ARC_COS,
  PLAYER_ATTACK_COOLDOWN_MS,
  PLAYER_ATTACK_DAMAGE,
  PLAYER_ATTACK_RANGE,
  PLAYER_MAX_HEALTH,
  PLAYER_MAX_STAMINA,
  STAMINA_REGEN_PER_SECOND,
} from "../../src/shared/constants/game.js";
import type { InventoryItem } from "../../src/shared/types/core.js";
import { at, ASH_IMP_ID, monster, testPlayer, testProfile, testSession } from "./fixtures.js";

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
        swing: {
          origin: at(11, 2, -IN_REACH),
          facing: { x: 1, y: 0 },
          range: PLAYER_ATTACK_RANGE,
          arcCos: PLAYER_ATTACK_ARC_COS,
        },
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

/** A sword whose every stat differs from the unarmed constants, so each one is seen to apply. */
const TEST_BLADE: ItemDefinition = {
  id: "test-blade",
  name: "Test Blade",
  kind: "weapon",
  weapon: { kind: "melee", damage: 9, range: 2.5, arcCos: 0.9, cooldownMs: 800, staminaCost: 40 },
};

const IN_HAND: InventoryItem = {
  id: "a0000000-0000-4000-8000-0000000000b1",
  name: TEST_BLADE.name,
  kind: "weapon",
  itemId: TEST_BLADE.id,
  weaponKind: "melee",
};

/** A session whose content also defines `blade` and any extra `skills`. */
function withBlade(
  session: ReturnType<typeof testSession>,
  blade: ItemDefinition = TEST_BLADE,
  skills: SkillDefinition[] = [],
) {
  const shipped = loadContent();
  session.runDungeon.content = {
    ...shipped,
    items: new Map([...shipped.items, [blade.id, blade]]),
    skills: new Map([...shipped.skills, ...skills.map((skill) => [skill.id, skill] as const)]),
  };
  return session;
}

describe("weapon swings", () => {
  it("takes damage, reach, cooldown and stamina from the held weapon's content", () => {
    // 2 world units away: outside unarmed reach, inside the blade's.
    const player = testPlayer("alpha", { position: at(11, 2, -2), held: IN_HAND });
    const session = withBlade(testSession([player]));

    const swing = resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 0);

    expect(swing.ok && swing.event).toMatchObject({ targetId: ASH_IMP_ID, damage: 9, targetHealth: 3 });
    expect(player.stamina).toBe(PLAYER_MAX_STAMINA - 40);
    expect(resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 799)).toEqual({
      ok: false,
      reason: "onCooldown",
    });
    expect(resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 800).ok).toBe(true);
  });

  it("reports the held weapon's reach and arc, for a hit and for a miss", () => {
    const hit = withBlade(testSession([testPlayer("alpha", { position: at(11, 2, -2), held: IN_HAND })]));
    const miss = withBlade(testSession([testPlayer("alpha", { position: at(2, 2), held: IN_HAND })]));
    const { range, arcCos } = TEST_BLADE.weapon as { range: number; arcCos: number };

    const struck = resolvePlayerAttack(hit, "alpha", { x: 1, y: 0 }, null, 0);
    const missed = resolvePlayerAttack(miss, "alpha", { x: 0, y: 1 }, null, 0);

    expect(struck.ok && struck.event.targetId).toBe(ASH_IMP_ID);
    expect(struck.ok && struck.event.swing).toEqual({
      origin: at(11, 2, -2),
      facing: { x: 1, y: 0 },
      range,
      arcCos,
    });
    expect(missed.ok && missed.event.targetId).toBeNull();
    expect(missed.ok && missed.event.swing).toEqual({
      origin: at(2, 2),
      facing: { x: 0, y: 1 },
      range,
      arcCos,
    });
  });

  it("reports the unarmed reach and arc for an empty hand or an unknown weapon", () => {
    const empty = testPlayer("alpha", { position: at(2, 2) });
    const orphan = testPlayer("beta", { position: at(2, 2), held: { ...IN_HAND, itemId: "no-such-blade" } });

    for (const player of [empty, orphan]) {
      const swing = resolvePlayerAttack(testSession([player]), player.id, { x: 0, y: 1 }, null, 0);
      expect(swing.ok && swing.event.swing).toMatchObject({
        range: PLAYER_ATTACK_RANGE,
        arcCos: PLAYER_ATTACK_ARC_COS,
        facing: { x: 0, y: 1 },
      });
    }
  });

  it("follows an edit to the content file with no code change", () => {
    const player = testPlayer("alpha", { position: at(11, 2, -IN_REACH), held: IN_HAND });
    // The same id with different numbers: what a restarted server loads after the file is edited.
    const edited: ItemDefinition = {
      ...TEST_BLADE,
      weapon: { kind: "melee", damage: 2, range: 2.5, arcCos: 0.9, cooldownMs: 800, staminaCost: 5 },
    };
    const session = withBlade(testSession([player]), edited);

    const swing = resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 0);

    expect(swing.ok && swing.event.damage).toBe(2);
    expect(player.stamina).toBe(PLAYER_MAX_STAMINA - 5);
  });

  it("uses the blade's narrower arc", () => {
    // 45 degrees off the swing: inside the unarmed 60-degree arc, outside the blade's ~26.
    const offset = IN_REACH / Math.SQRT2;
    const imp = at(11, 2);
    const position = { x: imp.x - offset, y: imp.y - offset };
    const unarmed = testSession([testPlayer("alpha", { position })]);
    const armed = withBlade(testSession([testPlayer("alpha", { position, held: IN_HAND })]));

    expect(resolvePlayerAttack(unarmed, "alpha", { x: 1, y: 0 }, null, 0)).toMatchObject({
      ok: true,
      event: { targetId: ASH_IMP_ID },
    });
    expect(resolvePlayerAttack(armed, "alpha", { x: 1, y: 0 }, null, 0)).toMatchObject({
      ok: true,
      event: { targetId: null },
    });
  });

  it("swings unarmed with an empty hand or a weapon content no longer defines", () => {
    const empty = testPlayer("alpha", { position: at(11, 2, -IN_REACH) });
    const orphan = testPlayer("beta", {
      position: at(11, 2, -IN_REACH),
      held: { ...IN_HAND, itemId: "no-such-blade" },
    });

    for (const player of [empty, orphan]) {
      const session = testSession([player]);
      const swing = resolvePlayerAttack(session, player.id, { x: 1, y: 0 }, null, 0);
      expect(swing.ok && swing.event.damage).toBe(PLAYER_ATTACK_DAMAGE);
      expect(player.stamina).toBe(PLAYER_MAX_STAMINA - ATTACK_STAMINA_COST);
      expect(player.nextAttackAt).toBe(PLAYER_ATTACK_COOLDOWN_MS);
    }
  });

  it("refuses a swing the player cannot pay for, at no cost", () => {
    const player = testPlayer("alpha", { position: at(11, 2, -IN_REACH), held: IN_HAND, stamina: 39 });
    const session = withBlade(testSession([player]));

    expect(resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 0)).toEqual({
      ok: false,
      reason: "exhausted",
    });
    expect(player.stamina).toBe(39);
    expect(player.nextAttackAt).toBeNull();
    expect(monster(session, ASH_IMP_ID).health).toBe(12);
  });

  it("stacks attackDamageBonus on top of the weapon's damage", () => {
    const player = testPlayer("alpha", {
      position: at(11, 2, -IN_REACH),
      held: IN_HAND,
      profile: testProfile("alpha", { unlockedSkillIds: ["battle-focus"] }),
    });
    const session = withBlade(testSession([player]), TEST_BLADE, [
      {
        id: "battle-focus",
        name: "Battle Focus",
        description: "Hit harder.",
        effects: [{ type: "attackDamageBonus", amount: 2 }],
      },
    ]);
    monster(session, ASH_IMP_ID).health = 50;

    const swing = resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 0);

    expect(swing.ok && swing.event.damage).toBe(9 + 2);
  });
});

describe("swinging in the hub", () => {
  function hubSession(player: ReturnType<typeof testPlayer>) {
    const session = testSession([player], HUB_DUNGEON_ID);
    session.location = "hub";
    return session;
  }

  it("lets a new player pick up the shipped sword and swing it at nothing, paying for it", () => {
    const sword = hubSession(testPlayer("alpha")).dungeon.loot.find(
      (loot) => loot.kind === "weapon" && loot.itemId === "rusted-sword",
    );
    if (!sword) throw new Error("the hub should hold the rusted sword");
    const player = testPlayer("alpha", { position: { ...sword.position } });
    const session = hubSession(player);

    expect(pickupItem(session, "alpha", sword.id)).toEqual({ ok: true });
    expect(player.held).toMatchObject({ kind: "weapon", itemId: "rusted-sword" });

    const swing = resolvePlayerAttack(session, "alpha", { x: 0, y: -1 }, null, 0);

    expect(swing).toMatchObject({ ok: true, event: { targetId: null, damage: 0 } });
    expect(player.stamina).toBe(PLAYER_MAX_STAMINA - ATTACK_STAMINA_COST);
    expect(resolvePlayerAttack(session, "alpha", { x: 0, y: -1 }, null, 1)).toEqual({
      ok: false,
      reason: "onCooldown",
    });
  });

  it("refuses an unaffordable hub swing, and regenerates stamina there", () => {
    const player = testPlayer("alpha", { stamina: ATTACK_STAMINA_COST - 1 });
    const session = hubSession(player);

    expect(resolvePlayerAttack(session, "alpha", { x: 1, y: 0 }, null, 0)).toEqual({
      ok: false,
      reason: "exhausted",
    });
    expect(player.nextAttackAt).toBeNull();

    simulate(session, 0);
    simulate(session, 100);

    expect(player.stamina).toBeCloseTo(ATTACK_STAMINA_COST - 1 + STAMINA_REGEN_PER_SECOND * 0.1);
    expect(player.resistance).toBe(testPlayer("x").resistance);
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

  it("winds up before a hit lands, and starts the cooldown at resolution", () => {
    // Zero resistance, so this test measures timing rather than damage reduction.
    const player = testPlayer("alpha", { position: at(11, 2, -IN_REACH), resistance: 0 });
    const session = testSession([player]);
    const { damage, attackCooldownMs, windupMs } = impStats();
    const imp = monster(session, ASH_IMP_ID);
    const impHits = (now: number) =>
      simulate(session, now).filter((event) => event.attackerId === ASH_IMP_ID);

    expect(impHits(0)).toEqual([]);
    expect(imp.action).toBe("windingUp");
    expect(imp.windupProgress).toBe(0);
    expect(imp.facing.x).toBeCloseTo(-1);

    expect(impHits(windupMs / 2)).toEqual([]);
    expect(imp.windupProgress).toBeCloseTo(0.5);
    expect(player.health).toBe(PLAYER_MAX_HEALTH);

    expect(impHits(windupMs)).toEqual([
      {
        type: "attackResolved",
        attackerId: ASH_IMP_ID,
        targetId: "alpha",
        damage,
        targetHealth: PLAYER_MAX_HEALTH - damage,
        targetDefeated: false,
        swing: null,
      },
    ]);
    expect(imp.action).toBe("idle");

    // The cooldown ran from resolution, so the next swing only begins once it has passed.
    expect(impHits(windupMs + attackCooldownMs - 1)).toEqual([]);
    expect(imp.action).toBe("idle");
    expect(impHits(windupMs + attackCooldownMs)).toEqual([]);
    expect(imp.action).toBe("windingUp");
    expect(impHits(windupMs + attackCooldownMs + windupMs)).toHaveLength(1);
    expect(player.health).toBe(PLAYER_MAX_HEALTH - 2 * damage);
  });

  it("hits nothing when the player steps out of reach during the wind-up", () => {
    const player = testPlayer("alpha", { position: at(11, 2, -IN_REACH), resistance: 0 });
    const session = testSession([player]);
    const { windupMs } = impStats();

    simulate(session, 0);
    player.position = at(11, 2, -3);

    expect(simulate(session, windupMs)).toEqual([]);
    expect(player.health).toBe(PLAYER_MAX_HEALTH);
    expect(monster(session, ASH_IMP_ID).action).toBe("idle");
  });

  it("hits nothing when the player slips behind the swing", () => {
    const player = testPlayer("alpha", { position: at(11, 2, -IN_REACH), resistance: 0 });
    const session = testSession([player]);
    const { windupMs } = impStats();

    simulate(session, 0);
    // Still inside reach, but behind the facing fixed when the wind-up began.
    player.position = at(11, 2, 0.5);

    expect(simulate(session, windupMs)).toEqual([]);
    expect(player.health).toBe(PLAYER_MAX_HEALTH);
  });

  it("does not hit a player who went down or disconnected mid wind-up", () => {
    for (const change of [{ health: 0 }, { connected: false }]) {
      const player = testPlayer("alpha", { position: at(11, 2, -IN_REACH), resistance: 0 });
      const session = testSession([player]);

      simulate(session, 0);
      Object.assign(player, change);

      expect(simulate(session, impStats().windupMs)).toEqual([]);
      expect(player.health).toBe(change.health ?? PLAYER_MAX_HEALTH);
    }
  });

  it("holds its ground while winding up", () => {
    const player = testPlayer("alpha", { position: at(11, 2, -IN_REACH) });
    const session = testSession([player]);
    const imp = monster(session, ASH_IMP_ID);

    simulate(session, 0);
    const before = { ...imp.position };
    player.position = at(11, 2, -3);
    simulate(session, 100);

    expect(imp.position).toEqual(before);
  });

  it("reports the damage resistance actually let through", () => {
    const player = testPlayer("alpha", { position: at(11, 2, -IN_REACH), resistance: 100 });
    const session = testSession([player]);
    const { damage, windupMs } = impStats();

    simulate(session, 0);
    const [hit] = simulate(session, windupMs).filter((event) => event.attackerId === ASH_IMP_ID);

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

  it("downs a player and leaves them down until the run lifecycle resolves", () => {
    const player = testPlayer("alpha", { position: at(11, 2, -IN_REACH), health: 1, resistance: 0 });
    const session = testSession([player]);

    simulate(session, 0);
    const [hit] = simulate(session, impStats().windupMs);

    expect(hit).toMatchObject({ targetId: "alpha", damage: 1, targetHealth: 0, targetDefeated: true });
    expect(simulate(session, 60_000)).toEqual([]);
    expect(player.health).toBe(0);
    expect(player.position).toEqual(at(11, 2, -IN_REACH));
  });
});
