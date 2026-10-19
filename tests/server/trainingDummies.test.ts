import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import type { ItemDefinition, SkillDefinition } from "../../src/server/content/schema.js";
import { resolvePlayerAttack, simulate } from "../../src/server/game/combat.js";
import { HUB_DUNGEON_ID } from "../../src/server/game/dungeonState.js";
import { refreshDummies } from "../../src/server/game/dummies.js";
import { startRun } from "../../src/server/game/runLifecycle.js";
import { visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import {
  PLAYER_ATTACK_ARC_COS,
  PLAYER_ATTACK_DAMAGE,
  PLAYER_ATTACK_RANGE,
  PLAYER_MAX_STAMINA,
  TRAINING_DUMMY_WINDOW_MS,
} from "../../src/shared/constants/game.js";
import type { InventoryItem } from "../../src/shared/types/core.js";
import { ASH_IMP_ID, at, monster, testPlayer, testProfile, testSession } from "./fixtures.js";

/** The hub's two dummies, from `content/dungeons/hub.json`. */
const DUMMY_A = "b1111111-1111-4111-8111-111111111111";
const DUMMY_B = "b2222222-2222-4222-8222-222222222222";
const DUMMY_A_TILE = { x: 15, y: 7 };

/** World units west of dummy A: inside unarmed reach, outside the overlap radius. */
const IN_REACH = 1;

const RUSTED_SWORD: InventoryItem = {
  id: "a0000000-0000-4000-8000-0000000000c1",
  name: "Rusted Sword",
  kind: "weapon",
  itemId: "rusted-sword",
  weaponKind: "melee",
};

/** A blade that reaches further than a fist, so reach is seen to come from the weapon. */
const LONG_BLADE: ItemDefinition = {
  id: "long-blade",
  name: "Long Blade",
  kind: "weapon",
  weapon: { kind: "melee", damage: 9, range: 2.5, arcCos: 0.9, cooldownMs: 800, staminaCost: 15 },
};
const LONG_BLADE_IN_HAND: InventoryItem = {
  id: "a0000000-0000-4000-8000-0000000000c2",
  name: LONG_BLADE.name,
  kind: "weapon",
  itemId: LONG_BLADE.id,
  weaponKind: "melee",
};

const BATTLE_FOCUS: SkillDefinition = {
  id: "battle-focus",
  name: "Battle Focus",
  description: "Hit harder.",
  effects: [{ type: "attackDamageBonus", amount: 2 }],
};

function hubSession(players: ReturnType<typeof testPlayer>[]) {
  const session = testSession(players, HUB_DUNGEON_ID);
  session.location = "hub";
  const shipped = loadContent();
  session.runDungeon.content = {
    ...shipped,
    items: new Map([...shipped.items, [LONG_BLADE.id, LONG_BLADE]]),
    skills: new Map([...shipped.skills, [BATTLE_FOCUS.id, BATTLE_FOCUS]]),
  };
  return session;
}

function dummy(session: ReturnType<typeof testSession>, id = DUMMY_A) {
  const found = session.dungeon.dummies.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No dummy ${id}`);
  return found;
}

/** Swings east at dummy A from `player`'s position at `now`, topping stamina up first. */
function swingAt(session: ReturnType<typeof testSession>, playerId: string, now: number) {
  const player = session.players.get(playerId)!;
  player.stamina = PLAYER_MAX_STAMINA;
  player.nextAttackAt = null;
  return resolvePlayerAttack(session, playerId, { x: 1, y: 0 }, null, now);
}

describe("training dummies in the hub", () => {
  it("ships two dummies in the hub, on floor, at their authored tiles", () => {
    const session = hubSession([testPlayer("alpha")]);

    expect(session.dungeon.dummies.map((placed) => placed.id)).toEqual([DUMMY_A, DUMMY_B]);
    expect(dummy(session).position).toEqual(at(DUMMY_A_TILE.x, DUMMY_A_TILE.y));
    expect(session.dungeon.monsters).toEqual([]);
  });

  it("takes an unarmed hit at full damage without dying", () => {
    const session = hubSession([testPlayer("alpha", { position: at(15, 7, -IN_REACH) })]);

    expect(swingAt(session, "alpha", 0)).toEqual({
      ok: true,
      event: {
        type: "attackResolved",
        attackerId: "alpha",
        targetId: DUMMY_A,
        damage: PLAYER_ATTACK_DAMAGE,
        targetHealth: 0,
        targetDefeated: false,
        swing: {
          origin: at(15, 7, -IN_REACH),
          facing: { x: 1, y: 0 },
          range: PLAYER_ATTACK_RANGE,
          arcCos: PLAYER_ATTACK_ARC_COS,
        },
      },
    });
    expect(dummy(session)).toMatchObject({ recentDamage: PLAYER_ATTACK_DAMAGE });
  });

  it("takes a hit from the held Rusted Sword, with attackDamageBonus on top", () => {
    const player = testPlayer("alpha", {
      position: at(15, 7, -IN_REACH),
      held: RUSTED_SWORD,
      profile: testProfile("alpha", { unlockedSkillIds: [BATTLE_FOCUS.id] }),
    });
    const session = hubSession([player]);
    const swordDamage = (() => {
      const sword = loadContent().items.get("rusted-sword");
      if (sword?.kind !== "weapon" || sword.weapon.kind !== "melee") throw new Error("no sword");
      return sword.weapon.damage;
    })();

    const swing = swingAt(session, "alpha", 0);

    expect(swing.ok && swing.event).toMatchObject({
      targetId: DUMMY_A,
      damage: swordDamage + 2,
      targetDefeated: false,
    });
    expect(dummy(session).recentDamage).toBe(swordDamage + 2);
  });

  it("never dies, never moves, and leaves loot, the profile and monsters alone", () => {
    const player = testPlayer("alpha", { position: at(15, 7, -IN_REACH) });
    const session = hubSession([player]);
    const before = structuredClone(dummy(session).position);
    const lootBefore = structuredClone(session.dungeon.loot);
    const profileBefore = structuredClone(player.profile);

    for (let hit = 0; hit < 50; hit += 1) {
      const swing = swingAt(session, "alpha", hit * 1000);
      expect(swing.ok && swing.event).toMatchObject({ targetId: DUMMY_A, targetDefeated: false });
      expect(simulate(session, hit * 1000 + 500)).toEqual([]);
    }

    expect(session.dungeon.dummies.map((placed) => placed.id)).toEqual([DUMMY_A, DUMMY_B]);
    expect(dummy(session).position).toEqual(before);
    expect(session.dungeon.loot).toEqual(lootBefore);
    expect(session.dungeon.monsters).toEqual([]);
    expect(session.monsterPosts.size).toBe(0);
    expect(player.profile).toEqual(profileBefore);
    expect(player.runSkillIds.size).toBe(0);
  });

  it("is ignored by monsters, which neither chase nor strike it", () => {
    const session = testSession([testPlayer("alpha", { position: at(2, 2) })]);
    const imp = monster(session, ASH_IMP_ID);
    session.dungeon.dummies.push({
      id: DUMMY_A,
      position: { x: imp.position.x - IN_REACH, y: imp.position.y },
      recentDamage: 0,
      dps: 0,
      attackers: [],
    });
    const impHome = structuredClone(imp.position);

    const events = [];
    for (let now = 0; now <= 3000; now += 50) events.push(...simulate(session, now));

    expect(events).toEqual([]);
    expect(imp.action).toBe("idle");
    expect(imp.position).toEqual(impHome);
    expect(dummy(session)).toMatchObject({ recentDamage: 0, attackers: [] });
  });

  it("is not carried into a run, and a run starts with no dummy hits on record", () => {
    const player = testPlayer("alpha", { position: at(15, 7, -IN_REACH), ready: true });
    const session = hubSession([player]);
    session.runDungeon.dungeonId = "vault-run";
    swingAt(session, "alpha", 0);
    expect(session.dummyHits.size).toBe(1);

    expect(startRun(session, 100)).toEqual({ ok: true });

    expect(session.dungeon.dummies).toEqual([]);
    expect(session.dummyHits.size).toBe(0);
  });
});

describe("training dummy reach", () => {
  it("misses a dummy out of reach or outside the arc, as it would a monster", () => {
    const far = hubSession([testPlayer("alpha", { position: at(15, 7, -(PLAYER_ATTACK_RANGE + 0.3)) })]);
    const behind = hubSession([testPlayer("alpha", { position: at(15, 7, -IN_REACH) })]);

    expect(swingAt(far, "alpha", 0)).toMatchObject({ ok: true, event: { targetId: null, damage: 0 } });
    expect(
      resolvePlayerAttack(behind, "alpha", { x: -1, y: 0 }, null, 0),
    ).toMatchObject({ ok: true, event: { targetId: null, damage: 0 } });
    expect(dummy(far).recentDamage).toBe(0);
    expect(dummy(behind).recentDamage).toBe(0);
  });

  it("refuses a swing aimed at a dummy out of reach, and accepts one in reach", () => {
    const far = hubSession([testPlayer("alpha", { position: at(15, 7, -2) })]);
    const near = hubSession([testPlayer("alpha", { position: at(15, 7, -IN_REACH) })]);

    expect(resolvePlayerAttack(far, "alpha", { x: 1, y: 0 }, DUMMY_A, 0)).toEqual({
      ok: false,
      reason: "outOfRange",
    });
    expect(resolvePlayerAttack(near, "alpha", { x: 1, y: 0 }, DUMMY_A, 0)).toMatchObject({
      ok: true,
      event: { targetId: DUMMY_A },
    });
  });

  it("takes its reach from the held weapon", () => {
    const fist = hubSession([testPlayer("alpha", { position: at(15, 7, -2) })]);
    const blade = hubSession([testPlayer("alpha", { position: at(15, 7, -2), held: LONG_BLADE_IN_HAND })]);

    expect(swingAt(fist, "alpha", 0)).toMatchObject({ event: { targetId: null } });
    expect(swingAt(blade, "alpha", 0)).toMatchObject({
      event: { targetId: DUMMY_A, damage: 9, swing: { range: 2.5, arcCos: 0.9 } },
    });
  });
});

describe("training dummy readout", () => {
  it("averages each attacker's damage over the rolling window, then empties after idle", () => {
    const session = hubSession([
      testPlayer("alpha", { position: at(15, 7, -IN_REACH) }),
      testPlayer("beta", { position: at(15, 7, 0, -IN_REACH) }),
    ]);
    const swingSouth = (now: number) => {
      const beta = session.players.get("beta")!;
      beta.stamina = PLAYER_MAX_STAMINA;
      beta.nextAttackAt = null;
      return resolvePlayerAttack(session, "beta", { x: 0, y: 1 }, null, now);
    };

    swingAt(session, "alpha", 0);
    expect(swingSouth(500)).toMatchObject({ event: { targetId: DUMMY_A } });
    swingAt(session, "alpha", 1000);

    // A lone hit is averaged over at least a second, so beta's reads as its damage per second.
    expect(dummy(session)).toEqual(
      expect.objectContaining({
        recentDamage: 18,
        dps: 18,
        attackers: [
          { playerId: "alpha", recentDamage: 12, dps: 12 },
          { playerId: "beta", recentDamage: 6, dps: 6 },
        ],
      }),
    );

    refreshDummies(session, 4000);
    expect(dummy(session)).toMatchObject({
      recentDamage: 18,
      dps: 4.7,
      attackers: [
        { playerId: "alpha", recentDamage: 12, dps: 3 },
        { playerId: "beta", recentDamage: 6, dps: 1.7 },
      ],
    });

    // Alpha's first hit, at 0, is the first to age out.
    refreshDummies(session, TRAINING_DUMMY_WINDOW_MS);
    expect(dummy(session)).toMatchObject({
      recentDamage: 12,
      dps: 2.8,
      attackers: [
        { playerId: "beta", recentDamage: 6, dps: 1.3 },
        { playerId: "alpha", recentDamage: 6, dps: 1.5 },
      ],
    });

    refreshDummies(session, 1000 + TRAINING_DUMMY_WINDOW_MS);
    expect(dummy(session)).toMatchObject({ recentDamage: 0, dps: 0, attackers: [] });
    expect(session.dummyHits.size).toBe(0);
  });

  it("keeps each dummy's readout to its own hits", () => {
    const session = hubSession([testPlayer("alpha", { position: at(15, 7, -IN_REACH) })]);

    swingAt(session, "alpha", 0);

    expect(dummy(session).recentDamage).toBe(PLAYER_ATTACK_DAMAGE);
    expect(dummy(session, DUMMY_B)).toMatchObject({ recentDamage: 0, dps: 0, attackers: [] });
  });

  it("is refreshed by the simulation tick in the hub", () => {
    const session = hubSession([testPlayer("alpha", { position: at(15, 7, -IN_REACH) })]);
    swingAt(session, "alpha", 0);

    simulate(session, TRAINING_DUMMY_WINDOW_MS - 1);
    expect(dummy(session).recentDamage).toBe(PLAYER_ATTACK_DAMAGE);
    simulate(session, TRAINING_DUMMY_WINDOW_MS);
    expect(dummy(session).recentDamage).toBe(0);
  });

  it("sends every viewer of the dummy the same readout", () => {
    const alpha = testPlayer("alpha", { position: at(15, 7, -IN_REACH) });
    const beta = testPlayer("beta", { position: at(17, 8) });
    const session = hubSession([alpha, beta]);
    swingAt(session, "alpha", 0);
    swingAt(session, "alpha", 600);

    const seenByAlpha = visibilityFrameForPlayer(session, alpha).dungeon.dummies;
    const seenByBeta = visibilityFrameForPlayer(session, beta).dungeon.dummies;

    expect(seenByAlpha.find((placed) => placed.id === DUMMY_A)).toMatchObject({
      recentDamage: 2 * PLAYER_ATTACK_DAMAGE,
      attackers: [{ playerId: "alpha", recentDamage: 2 * PLAYER_ATTACK_DAMAGE }],
    });
    expect(seenByBeta).toEqual(seenByAlpha);
  });
});
