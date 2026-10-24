import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import { itemDefinitionSchema } from "../../src/server/content/schema.js";
import {
  beginDraw,
  bowMaxRange,
  drawFractionAfter,
  releaseDraw,
  shotRange,
} from "../../src/server/game/bow.js";
import { simulate } from "../../src/server/game/combat.js";
import { monsterInstance } from "../../src/server/game/dungeonBuilder.js";
import { advanceProjectiles } from "../../src/server/game/monsterAttacks.js";
import { HUB_DUNGEON_ID } from "../../src/server/game/dungeonState.js";
import { swapHeld } from "../../src/server/game/items.js";
import { returnToHub } from "../../src/server/game/runLifecycle.js";
import { SessionStore, toPlayerState, type Session } from "../../src/server/sessions/sessionStore.js";
import { PLAYER_MAX_STAMINA } from "../../src/shared/constants/game.js";
import type { InventoryItem, Vector2 } from "../../src/shared/types/core.js";
import { at, joinRequest, testPlayer, testSession } from "./fixtures.js";

const TICK_MS = 50;
const DUMMY_A = "b1111111-1111-4111-8111-111111111111";

const BOW_ITEM: InventoryItem = {
  id: "a0000000-0000-4000-8000-0000000000b1",
  name: "Hunting Bow",
  kind: "weapon",
  itemId: "hunting-bow",
  weaponKind: "ranged",
};
const SWORD_ITEM: InventoryItem = {
  id: "a0000000-0000-4000-8000-0000000000b2",
  name: "Rusted Sword",
  kind: "weapon",
  itemId: "rusted-sword",
  weaponKind: "melee",
};
const ARROWS: InventoryItem = {
  id: "a0000000-0000-4000-8000-0000000000b3",
  name: "Arrows",
  kind: "ammo",
  itemId: "arrow",
  count: 3,
};

const BOW = (() => {
  const definition = loadContent().items.get("hunting-bow");
  if (definition?.kind !== "weapon" || definition.weapon.kind !== "ranged") {
    throw new Error("hunting-bow is not a ranged weapon");
  }
  return definition.weapon;
})();

/** One world tile per character, a long lane with a wall at the east end. */
const LANE = [
  "##########################################",
  "#........................................#",
  "#........................................#",
  "##########################################",
];

function laneSession(shooter: Partial<ReturnType<typeof testPlayer>> = {}): Session {
  const session = testSession([
    testPlayer("alpha", {
      position: { x: 2, y: 1 },
      held: BOW_ITEM,
      inventory: [{ ...ARROWS }],
      ...shooter,
    }),
  ]);
  session.dungeon.map = {
    ...session.dungeon.map,
    width: LANE[0]!.length,
    height: LANE.length,
    originX: 0,
    originY: 0,
    tiles: LANE,
  };
  session.dungeon.monsters = [];
  session.dungeon.doors = [];
  session.dungeon.projectiles = [];
  session.dungeon.loot = [];
  session.dungeon.traps = [];
  session.dungeon.puzzles = [];
  session.dungeon.lightSources = [];
  return session;
}

function hubSession(shooter: Partial<ReturnType<typeof testPlayer>> = {}): Session {
  const session = testSession([testPlayer("alpha", { held: BOW_ITEM, inventory: [{ ...ARROWS }], ...shooter })], HUB_DUNGEON_ID);
  session.location = "hub";
  return session;
}

const EAST: Vector2 = { x: 1, y: 0 };

/** Draws for `heldMs` then releases east, returning the release result. */
function shoot(session: Session, heldMs: number, start = 1000) {
  const begin = beginDraw(session, "alpha", EAST, start);
  if (!begin.ok) return begin;
  return releaseDraw(session, "alpha", EAST, start + heldMs);
}

/**
 * Flies the arrows forward `ms` from `from` and returns every hit. Only the projectile step runs,
 * so a monster the arrow is aimed at stays where the test put it instead of walking at the shooter.
 */
function fly(session: Session, from: number, ms: number) {
  const events: ReturnType<typeof advanceProjectiles> = [];
  for (let at = from; at <= from + ms; at += TICK_MS) events.push(...advanceProjectiles(session, TICK_MS, at));
  return events;
}

function monsterAt(session: Session, x: number, typeId = "ash-imp") {
  const type = loadContent().monsters.get(typeId)!;
  const found = monsterInstance(type, { x, y: 1 }, crypto.randomUUID());
  session.dungeon.monsters.push(found);
  return found;
}

function arrowCount(session: Session): number {
  const stack = session.players.get("alpha")!.inventory.find((item) => item.kind === "ammo");
  return stack?.kind === "ammo" ? stack.count : 0;
}

describe("hunting bow content", () => {
  it("ships a ranged weapon whose ammo is a real ammo item", () => {
    const content = loadContent();
    expect(BOW.ammoItemId).toBe("arrow");
    expect(content.items.get("arrow")?.kind).toBe("ammo");
  });

  it("rejects ranged stats that are missing, unknown, or contradictory", () => {
    const base = { id: "b", name: "B", kind: "weapon", weapon: { ...BOW } };
    expect(itemDefinitionSchema.safeParse(base).success).toBe(true);
    const { ammoItemId: _ammo, ...withoutAmmo } = BOW;
    expect(itemDefinitionSchema.safeParse({ ...base, weapon: withoutAmmo }).success).toBe(false);
    expect(itemDefinitionSchema.safeParse({ ...base, weapon: { ...BOW, extra: 1 } }).success).toBe(false);
    expect(itemDefinitionSchema.safeParse({ ...base, weapon: { ...BOW, minRange: 99 } }).success).toBe(false);
    expect(itemDefinitionSchema.safeParse({ ...base, weapon: { ...BOW, minDrawMs: 99999 } }).success).toBe(false);
  });

  it("places one bow as hub loot", () => {
    const hub = hubSession();
    expect(hub.dungeon.loot.filter((loot) => loot.kind === "weapon" && loot.itemId === "hunting-bow")).toHaveLength(1);
  });
});

describe("draw to range", () => {
  const maxRange = (): number => bowMaxRange(BOW, testPlayer("alpha"), loadContent());

  it("grows monotonically with the draw and is flat once fully drawn", () => {
    const ranges = [0, 0.25, 0.5, 0.75, 1].map((fraction) => shotRange(BOW, maxRange(), fraction));
    for (let index = 1; index < ranges.length; index += 1) {
      expect(ranges[index]).toBeGreaterThan(ranges[index - 1]!);
    }
    expect(ranges[0]).toBe(BOW.minRange);
    expect(ranges[4]).toBe(BOW.maxRange);
    expect(shotRange(BOW, maxRange(), 5)).toBe(BOW.maxRange);
    expect(shotRange(BOW, maxRange(), -1)).toBe(BOW.minRange);
  });

  it("works the fraction out from time held, capped at one", () => {
    expect(drawFractionAfter(BOW, 0)).toBe(0);
    expect(drawFractionAfter(BOW, BOW.drawMs / 2)).toBe(0.5);
    expect(drawFractionAfter(BOW, BOW.drawMs)).toBe(1);
    expect(drawFractionAfter(BOW, BOW.drawMs * 10)).toBe(1);
  });

  it("flies an arrow to the range the server's own clock earned, and no further when over-held", () => {
    const landing = (heldMs: number): number => {
      const session = laneSession();
      expect(shoot(session, heldMs)).toEqual({ ok: true, fired: true });
      fly(session, 1000 + heldMs, 3000);
      return session.dungeon.projectiles.length;
    };
    expect(landing(500)).toBe(0);

    const flightEnd = (heldMs: number): number => {
      const session = laneSession();
      shoot(session, heldMs);
      const run = [...session.projectileRuns.values()][0]!;
      return run.remaining;
    };
    const quick = flightEnd(BOW.minDrawMs);
    const mid = flightEnd(BOW.drawMs / 2);
    const full = flightEnd(BOW.drawMs);
    const overheld = flightEnd(BOW.drawMs * 5);
    expect(quick).toBeLessThan(mid);
    expect(mid).toBeLessThan(full);
    expect(overheld).toBe(full);
    expect(full).toBe(BOW.maxRange);
  });

  it("goes visibly further after a long draw than a short one", () => {
    const reach = (heldMs: number): number => {
      const session = laneSession();
      shoot(session, heldMs);
      const clock = 1000 + heldMs;
      let farthest = 2;
      for (let time = clock; time < clock + 4000; time += TICK_MS) {
        simulate(session, time);
        for (const arrow of session.dungeon.projectiles) farthest = Math.max(farthest, arrow.position.x);
      }
      return farthest - 2;
    };
    expect(reach(BOW.drawMs)).toBeGreaterThan(reach(BOW.minDrawMs) + 5);
  });
});

describe("beginning and releasing a draw", () => {
  it("spends exactly one arrow and the configured stamina on a shot", () => {
    const session = laneSession();
    expect(shoot(session, BOW.drawMs)).toEqual({ ok: true, fired: true });

    const player = session.players.get("alpha")!;
    expect(arrowCount(session)).toBe(ARROWS.kind === "ammo" ? ARROWS.count - 1 : 0);
    expect(player.stamina).toBe(PLAYER_MAX_STAMINA - BOW.staminaCost);
    expect(player.draw).toBeNull();
    expect(session.dungeon.projectiles).toHaveLength(1);
  });

  it("removes the stack with its last arrow", () => {
    const session = laneSession({ inventory: [{ ...ARROWS, count: 1 }] });
    shoot(session, BOW.drawMs);
    expect(session.players.get("alpha")!.inventory).toEqual([]);
    expect(beginDraw(session, "alpha", EAST, 9000)).toEqual({ ok: false, reason: "targetMissing" });
  });

  it("refuses a draw with no arrows, spending nothing", () => {
    const session = laneSession({ inventory: [] });
    expect(beginDraw(session, "alpha", EAST, 1000)).toEqual({ ok: false, reason: "targetMissing" });
    expect(session.players.get("alpha")!.draw).toBeNull();
  });

  it("refuses a draw with no bow in hand, or the wrong item", () => {
    for (const held of [null, SWORD_ITEM]) {
      const session = laneSession({ held });
      expect(beginDraw(session, "alpha", EAST, 1000)).toEqual({ ok: false, reason: "notPermitted" });
      expect(session.players.get("alpha")!.draw).toBeNull();
      expect(arrowCount(session)).toBe(3);
    }
  });

  it("refuses a draw with too little stamina to start", () => {
    const session = laneSession({ stamina: BOW.staminaCost - 1 });
    expect(beginDraw(session, "alpha", EAST, 1000)).toEqual({ ok: false, reason: "exhausted" });
    expect(session.players.get("alpha")!.stamina).toBe(BOW.staminaCost - 1);
  });

  it("refuses a draw by a downed player and a draw with no direction", () => {
    expect(beginDraw(laneSession({ health: 0 }), "alpha", EAST, 1000)).toEqual({ ok: false, reason: "notPermitted" });
    expect(beginDraw(laneSession(), "alpha", { x: 0, y: 0 }, 1000)).toEqual({ ok: false, reason: "outOfRange" });
  });

  it("refuses a release with no draw in progress", () => {
    const session = laneSession();
    expect(releaseDraw(session, "alpha", EAST, 2000)).toEqual({ ok: false, reason: "notPermitted" });
    expect(arrowCount(session)).toBe(3);
    expect(session.dungeon.projectiles).toHaveLength(0);
  });

  it("fires nothing and costs nothing for a tap shorter than the minimum draw", () => {
    const session = laneSession();
    expect(shoot(session, BOW.minDrawMs - 1)).toEqual({ ok: true, fired: false });

    expect(arrowCount(session)).toBe(3);
    expect(session.players.get("alpha")!.stamina).toBe(PLAYER_MAX_STAMINA);
    expect(session.players.get("alpha")!.draw).toBeNull();
    expect(session.dungeon.projectiles).toHaveLength(0);
  });

  it("restarts the clock when a draw begins again", () => {
    const session = laneSession();
    beginDraw(session, "alpha", EAST, 1000);
    beginDraw(session, "alpha", EAST, 2500);
    expect(releaseDraw(session, "alpha", EAST, 2500 + BOW.minDrawMs - 1)).toEqual({ ok: true, fired: false });
  });

  it("refuses the release, spending nothing, when the arrows or stamina went away mid-draw", () => {
    const noArrows = laneSession();
    beginDraw(noArrows, "alpha", EAST, 1000);
    noArrows.players.get("alpha")!.inventory = [];
    expect(releaseDraw(noArrows, "alpha", EAST, 3000)).toEqual({ ok: false, reason: "targetMissing" });

    const winded = laneSession();
    beginDraw(winded, "alpha", EAST, 1000);
    winded.players.get("alpha")!.stamina = 0;
    expect(releaseDraw(winded, "alpha", EAST, 3000)).toEqual({ ok: false, reason: "exhausted" });
    expect(arrowCount(winded)).toBe(3);
    expect(winded.dungeon.projectiles).toHaveLength(0);
  });

  it("adds attackDamageBonus to the arrow, like a sword", () => {
    const session = laneSession();
    session.runDungeon.content = {
      ...loadContent(),
      skills: new Map([
        [
          "battle-focus",
          { id: "battle-focus", name: "Battle Focus", description: "x", effects: [{ type: "attackDamageBonus", amount: 3 }], maxStacks: 1, requires: [], conversionCoin: 1 },
        ],
      ]),
    };
    session.players.get("alpha")!.runSkillStacks.set("battle-focus", 1);
    shoot(session, BOW.drawMs);
    expect([...session.projectileRuns.values()][0]!.damage).toBe(BOW.damage + 3);
  });

  it("shows the draw fraction on the wire while drawing, and null after", () => {
    const session = laneSession();
    const player = session.players.get("alpha")!;
    expect(toPlayerState(player).drawFraction).toBeNull();

    beginDraw(session, "alpha", EAST, 1000);
    simulate(session, 1000 + BOW.drawMs / 2);
    expect(toPlayerState(player).drawFraction).toBeCloseTo(0.5, 5);
    simulate(session, 1000 + BOW.drawMs * 3);
    expect(toPlayerState(player).drawFraction).toBe(1);

    releaseDraw(session, "alpha", EAST, 1000 + BOW.drawMs * 3);
    expect(toPlayerState(player).drawFraction).toBeNull();
  });
});

describe("cancelling a draw", () => {
  function drawing(): Session {
    const session = laneSession();
    beginDraw(session, "alpha", EAST, 1000);
    return session;
  }

  function expectNothingSpent(session: Session): void {
    const player = session.players.get("alpha")!;
    expect(player.draw).toBeNull();
    expect(player.stamina).toBe(PLAYER_MAX_STAMINA);
    expect(arrowCount(session)).toBe(3);
    expect(session.dungeon.projectiles).toHaveLength(0);
  }

  it("ends on swapping the held item, and a later release is refused", () => {
    const session = drawing();
    const player = session.players.get("alpha")!;
    player.inventory.push({ ...SWORD_ITEM });
    expect(swapHeld(session, "alpha", SWORD_ITEM.id).ok).toBe(true);

    simulate(session, 1500);
    expectNothingSpent(session);
    expect(releaseDraw(session, "alpha", EAST, 3000).ok).toBe(false);
    expectNothingSpent(session);
  });

  it("ends on stowing the bow", () => {
    const session = drawing();
    expect(swapHeld(session, "alpha", null).ok).toBe(true);
    simulate(session, 1500);
    expectNothingSpent(session);
  });

  it("ends on going down", () => {
    const session = drawing();
    session.players.get("alpha")!.health = 0;
    simulate(session, 1500);
    expectNothingSpent(session);
  });

  it("ends on disconnecting, even before the next tick", () => {
    const store = new SessionStore({ dungeon: { dungeonId: "ember-vault" } });
    const session = store.createSession();
    const joined = store.join(joinRequest({ roomCode: session.roomCode, playerName: "Ana" }));
    if (!joined.ok) throw new Error("join failed");
    joined.player.draw = { heldId: "x", startedAt: 0, fraction: 0.4 };
    store.markDisconnected(joined.player.id);
    expect(joined.player.draw).toBeNull();
  });

  it("refuses a release from a player who dropped off mid-draw", () => {
    const session = drawing();
    session.players.get("alpha")!.connected = false;
    expect(releaseDraw(session, "alpha", EAST, 3000).ok).toBe(false);
    expectNothingSpent(session);
  });

  it("ends when the party returns to the hub", () => {
    const session = drawing();
    returnToHub(session, false);
    expect(session.players.get("alpha")!.draw).toBeNull();
  });

  it("lets a player keep moving while drawing", () => {
    const session = drawing();
    session.players.get("alpha")!.position = { x: 5, y: 1 };
    simulate(session, 1500);
    expect(session.players.get("alpha")!.draw).not.toBeNull();
    expect(releaseDraw(session, "alpha", EAST, 1000 + BOW.drawMs)).toEqual({ ok: true, fired: true });
  });
});

describe("the arrow in flight", () => {
  it("stops at a wall before reaching the end of its range", () => {
    const session = laneSession({ position: { x: 36, y: 1 } });
    shoot(session, BOW.drawMs);
    fly(session, 1000 + BOW.drawMs, 2000);
    expect(session.dungeon.projectiles).toHaveLength(0);
    expect(session.projectileRuns.size).toBe(0);
  });

  it("stops at a closed door and passes an open one", () => {
    const closed = laneSession();
    closed.dungeon.doors = [{ id: "d", position: { x: 8, y: 1 }, size: 1, open: false, lock: null }];
    const monster = monsterAt(closed, 12);
    shoot(closed, BOW.drawMs);
    const events = fly(closed, 1000 + BOW.drawMs, 2000);
    expect(events).toEqual([]);
    expect(monster.health).toBe(loadContent().monsters.get("ash-imp")!.maxHealth);

    const open = laneSession();
    open.dungeon.doors = [{ id: "d", position: { x: 8, y: 1 }, size: 1, open: true, lock: null }];
    monsterAt(open, 12);
    shoot(open, BOW.drawMs);
    expect(fly(open, 1000 + BOW.drawMs, 2000)).toHaveLength(1);
  });

  it("hits the first monster on its path, through the usual damage path, and stops", () => {
    const session = laneSession();
    const near = monsterAt(session, 8);
    const far = monsterAt(session, 12);
    const farHealth = far.health;
    shoot(session, BOW.drawMs);

    const events = fly(session, 1000 + BOW.drawMs, 2000);
    expect(events).toEqual([
      {
        type: "attackResolved",
        attackerId: "alpha",
        targetId: near.id,
        damage: Math.min(BOW.damage, 12),
        targetHealth: near.health,
        targetDefeated: near.health <= 0,
        swing: null,
      },
    ]);
    expect(far.health).toBe(farHealth);
    expect(session.dungeon.projectiles).toHaveLength(0);
  });

  it("kills a monster and drops its loot like any other kill", () => {
    const session = laneSession();
    const target = monsterAt(session, 8);
    target.health = 1;
    shoot(session, BOW.drawMs);
    const events = fly(session, 1000 + BOW.drawMs, 2000);
    expect(events[0]).toMatchObject({ targetId: target.id, targetDefeated: true, damage: 1 });
    expect(target.alive).toBe(false);
  });

  it("expires at its range without reaching a monster beyond it", () => {
    const session = laneSession();
    const beyond = monsterAt(session, 2 + BOW.minRange + 6);
    shoot(session, BOW.minDrawMs);
    const events = fly(session, 1000 + BOW.minDrawMs, 3000);
    expect(events).toEqual([]);
    expect(beyond.health).toBe(loadContent().monsters.get("ash-imp")!.maxHealth);
    expect(session.dungeon.projectiles).toHaveLength(0);
    expect(session.projectileRuns.size).toBe(0);
  });

  it("reaches a monster at full range that a tap could not", () => {
    const hits = (heldMs: number): number => {
      const session = laneSession();
      monsterAt(session, 2 + BOW.maxRange - 1);
      shoot(session, heldMs);
      return fly(session, 1000 + heldMs, 3000).length;
    };
    expect(hits(BOW.drawMs)).toBe(1);
    expect(hits(BOW.minDrawMs)).toBe(0);
  });

  it("passes through the party instead of hurting it", () => {
    const session = laneSession();
    session.players.set("beta", testPlayer("beta", { position: { x: 6, y: 1 } }));
    shoot(session, BOW.drawMs);
    fly(session, 1000 + BOW.drawMs, 2000);
    expect(session.players.get("beta")!.health).toBe(100);
  });
});

describe("shooting in the hub", () => {
  const SHOOTER = at(19, 3, -10);

  it("flies and fizzles at its range with nothing in the way", () => {
    const session = hubSession({ position: at(3, 3) });
    expect(shoot(session, BOW.drawMs)).toEqual({ ok: true, fired: true });
    expect(session.dungeon.projectiles).toHaveLength(1);

    fly(session, 1000 + BOW.drawMs, 2000);
    expect(session.dungeon.projectiles).toHaveLength(0);
    expect(session.projectileRuns.size).toBe(0);
  });

  it("hits a training dummy for its full damage and logs it on the readout", () => {
    const session = hubSession({ position: SHOOTER });
    shoot(session, BOW.drawMs);

    const events = fly(session, 1000 + BOW.drawMs, 2000);
    expect(events).toEqual([
      {
        type: "attackResolved",
        attackerId: "alpha",
        targetId: DUMMY_A,
        damage: BOW.damage,
        targetHealth: 0,
        targetDefeated: false,
        swing: null,
      },
    ]);
    expect(session.dungeon.dummies.find((dummy) => dummy.id === DUMMY_A)).toMatchObject({
      recentDamage: BOW.damage,
    });
    expect(session.dungeon.projectiles).toHaveLength(0);
  });
});
