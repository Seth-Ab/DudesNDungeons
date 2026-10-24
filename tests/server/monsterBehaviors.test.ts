import { describe, expect, it } from "vitest";
import { gameContent } from "../../src/server/content/loadContent.js";
import { monsterTypeSchema } from "../../src/server/content/schema.js";
import { simulate } from "../../src/server/game/combat.js";
import { monsterInstance } from "../../src/server/game/dungeonBuilder.js";
import { visibilityFrameForPlayer } from "../../src/server/game/visibility.js";
import type { Session } from "../../src/server/sessions/sessionStore.js";
import { PLAYER_RADIUS, distance } from "../../src/shared/game/movement.js";
import type { DoorState, MonsterState, Vector2 } from "../../src/shared/types/core.js";
import { testPlayer, testSession } from "./fixtures.js";

const TICK_MS = 50;

/** One world tile per character. A corridor along the middle with a wall at the east end. */
const HALL = [
  "######################################",
  "#....................................#",
  "#....................................#",
  "#....................................#",
  "######################################",
];

function spawn(typeId: string, position: Vector2): MonsterState {
  const type = gameContent().monsters.get(typeId);
  if (!type) throw new Error(`No monster type ${typeId}`);
  return monsterInstance(type, position, crypto.randomUUID());
}

function hallSession(
  monsters: MonsterState[],
  players: Record<string, Vector2>,
  doors: DoorState[] = [],
): Session {
  const session = testSession(
    Object.entries(players).map(([id, position]) => testPlayer(id, { position, resistance: 0 })),
  );
  session.dungeon.map = {
    ...session.dungeon.map,
    width: HALL[0]!.length,
    height: HALL.length,
    originX: 0,
    originY: 0,
    tiles: HALL,
  };
  session.dungeon.monsters = monsters;
  session.dungeon.doors = doors;
  session.dungeon.projectiles = [];
  session.dungeon.loot = [];
  session.dungeon.traps = [];
  session.dungeon.puzzles = [];
  session.dungeon.lightSources = [];
  return session;
}

function run(session: Session, ms: number, clock = { now: 0 }) {
  const events: ReturnType<typeof simulate> = [];
  for (let end = clock.now + ms; clock.now < end; clock.now += TICK_MS) {
    events.push(...simulate(session, clock.now));
  }
  return events;
}

describe("monster behaviour content", () => {
  const ASH_IMP = {
    id: "ash-imp",
    name: "Ash Imp",
    maxHealth: 12,
    speed: 1.8,
    aggroRange: 5,
    attackRange: 1,
    damage: 8,
    attackCooldownMs: 1000,
  };

  it("rejects a ranged monster without projectile stats", () => {
    const result = monsterTypeSchema.safeParse({ ...ASH_IMP, behavior: "ranged" });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain("projectile");
  });

  it("rejects a charger without charge stats and stats on the wrong behaviour", () => {
    expect(monsterTypeSchema.safeParse({ ...ASH_IMP, behavior: "charger" }).success).toBe(false);
    expect(
      monsterTypeSchema.safeParse({
        ...ASH_IMP,
        charge: { speed: 10, distance: 5, stunMs: 500 },
      }).success,
    ).toBe(false);
  });

  it("defaults to melee, and ships one monster of each archetype", () => {
    expect(monsterTypeSchema.parse(ASH_IMP).behavior).toBe("melee");
    const { monsters, templates } = gameContent();
    expect(monsters.get("cinder-spitter")?.behavior).toBe("ranged");
    expect(monsters.get("slag-charger")?.behavior).toBe("charger");
    const placed = [...templates.values()].flatMap((template) =>
      template.monsters.map((rule) => rule.typeId),
    );
    expect(placed).toContain("cinder-spitter");
    expect(placed).toContain("slag-charger");
  });
});

describe("ranged monsters", () => {
  const stats = () => gameContent().monsters.get("cinder-spitter")!;

  it("fires a bolt that hits the first player on its path, scaled by resistance", () => {
    const spitter = spawn("cinder-spitter", { x: 5, y: 2 });
    const session = hallSession([spitter], { front: { x: 11, y: 2 }, back: { x: 13, y: 2 } });
    session.players.get("front")!.resistance = 50;
    const clock = { now: 0 };

    const events = run(session, 3000, clock);

    const hits = events.filter((event) => event.attackerId === spitter.id);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits.every((hit) => hit.targetId === "front")).toBe(true);
    expect(hits[0]!.damage).toBeGreaterThan(0);
    expect(hits[0]!.damage).toBeLessThan(stats().projectile!.damage);
    expect(session.players.get("back")!.health).toBe(100);
  });

  it("telegraphs before firing and does not fire when the target steps out of the lane", () => {
    const spitter = spawn("cinder-spitter", { x: 5, y: 2 });
    const session = hallSession([spitter], { alpha: { x: 11, y: 2 } });
    const clock = { now: 0 };

    run(session, 300, clock);
    expect(spitter.action).toBe("windingUp");
    expect(session.dungeon.projectiles).toHaveLength(0);

    session.players.get("alpha")!.position = { x: 11, y: 3.2 };
    const events = run(session, 3000, clock);

    expect(events).toEqual([]);
    expect(session.players.get("alpha")!.health).toBe(100);
  });

  it("stops a bolt at a wall", () => {
    const spitter = spawn("cinder-spitter", { x: 5, y: 2 });
    const session = hallSession([spitter], { alpha: { x: 11, y: 2 } });
    const clock = { now: 0 };
    run(session, 1000, clock);
    // Wall the lane off between the two.
    session.dungeon.map.tiles = HALL.map((row, y) =>
      y === 2 ? row.slice(0, 8) + "#" + row.slice(9) : row,
    );
    session.players.get("alpha")!.position = { x: 11, y: 2 };

    const events = run(session, 1500, clock);

    expect(events.filter((event) => event.attackerId === spitter.id)).toEqual([]);
    expect(session.dungeon.projectiles).toHaveLength(0);
    expect(session.projectileRuns.size).toBe(0);
  });

  it("stops a bolt at a closed door", () => {
    const spitter = spawn("cinder-spitter", { x: 5, y: 2 });
    const session = hallSession([spitter], { alpha: { x: 11, y: 2 } }, [
      { id: "d", position: { x: 8, y: 2 }, size: 1, open: false, lock: null },
    ]);

    const events = run(session, 4000);

    expect(events.filter((event) => event.attackerId === spitter.id)).toEqual([]);
    expect(session.dungeon.projectiles.length).toBeLessThanOrEqual(1);
  });

  it("expires a bolt after its range", () => {
    const spitter = spawn("cinder-spitter", { x: 2, y: 2 });
    const session = hallSession([spitter], {});
    const bolt = stats().projectile!;
    session.dungeon.projectiles.push({
      id: "bolt",
      position: { x: 2, y: 2 },
      direction: { x: 1, y: 0 },
      radius: bolt.radius,
    });
    session.projectileRuns.set("bolt", {
      ownerId: spitter.id,
      damage: bolt.damage,
      speed: bolt.speed,
      remaining: bolt.range,
    });
    spitter.alive = false;

    const clock = { now: 0 };
    run(session, ((bolt.range - 1) / bolt.speed) * 1000, clock);
    expect(session.dungeon.projectiles).toHaveLength(1);
    expect(session.dungeon.projectiles[0]!.position.x).toBeLessThan(2 + bolt.range);

    run(session, 400, clock);
    expect(session.dungeon.projectiles).toHaveLength(0);
    expect(session.projectileRuns.size).toBe(0);
  });

  it("keeps its distance when a player closes in", () => {
    const spitter = spawn("cinder-spitter", { x: 20, y: 2 });
    const session = hallSession([spitter], { alpha: { x: 17, y: 2 } });
    const preferred = stats().preferredRange!;
    // Mid-cooldown, so it backs off instead of committing to a shot.
    session.monsterCooldowns.set(spitter.id, 10_000);

    run(session, 600);

    expect(distance(spitter.position, session.players.get("alpha")!.position)).toBeGreaterThan(3);
    expect(spitter.position.x).toBeGreaterThan(20);
    expect(preferred).toBeGreaterThan(3);
  });

  it("only sends a projectile to players who can see it", () => {
    const spitter = spawn("cinder-spitter", { x: 5, y: 2 });
    const session = hallSession([spitter], { near: { x: 7, y: 2 }, far: { x: 34, y: 2 } });
    // A wall between them: the far player sees neither the bolt nor the torch lighting it.
    session.dungeon.map.tiles = HALL.map((row, y) =>
      y === 0 || y === 4 ? row : row.slice(0, 20) + "#" + row.slice(21),
    );
    session.dungeon.projectiles.push({
      id: "bolt",
      position: { x: 6, y: 2 },
      direction: { x: 1, y: 0 },
      radius: 0.25,
    });

    const near = visibilityFrameForPlayer(session, session.players.get("near")!);
    const far = visibilityFrameForPlayer(session, session.players.get("far")!);

    expect(near.dungeon.projectiles.map((bolt) => bolt.id)).toEqual(["bolt"]);
    expect(far.dungeon.projectiles).toEqual([]);
  });
});

describe("charging monsters", () => {
  const stats = () => gameContent().monsters.get("slag-charger")!;

  /** Winds up on the first in-range tick, then dashes. */
  function windUpAndCharge(charger: MonsterState, session: Session, clock = { now: 0 }) {
    run(session, stats().windupMs + TICK_MS * 2, clock);
    expect(charger.action).toBe("charging");
    return clock;
  }

  it("winds up, then dashes in a straight line for its fixed distance", () => {
    const charger = spawn("slag-charger", { x: 3, y: 2 });
    const session = hallSession([charger], { alpha: { x: 9, y: 2 } });
    const clock = { now: 0 };

    run(session, 300, clock);
    expect(charger.action).toBe("windingUp");
    expect(charger.position.x).toBe(3);

    // The player steps out of the lane during the wind-up.
    session.players.get("alpha")!.position = { x: 9, y: 3.4 };
    const start = { ...charger.position };
    const events = run(session, 2000, clock);

    expect(events).toEqual([]);
    expect(charger.position.x - start.x).toBeCloseTo(stats().charge!.distance, 1);
    expect(charger.position.y).toBe(start.y);
    expect(charger.action).toBe("idle");
  });

  it("hits a player in its path with resistance-scaled damage and ends the dash", () => {
    const charger = spawn("slag-charger", { x: 3, y: 2 });
    const session = hallSession([charger], { alpha: { x: 9, y: 2 } });
    session.players.get("alpha")!.resistance = 50;

    const events = run(session, 2500);

    const hit = events.find((event) => event.attackerId === charger.id);
    expect(hit).toBeDefined();
    expect(hit!.damage).toBeGreaterThan(0);
    expect(hit!.damage).toBeLessThan(stats().damage);
    expect(distance(charger.position, session.players.get("alpha")!.position)).toBeLessThan(
      PLAYER_RADIUS * 2 + 0.2,
    );
    expect(charger.action).toBe("idle");
  });

  it("stops at a wall and is stunned for the configured time", () => {
    const charger = spawn("slag-charger", { x: 30, y: 2 });
    const session = hallSession([charger], { alpha: { x: 25, y: 3.4 } });
    const clock = { now: 0 };
    // Aim the dash along the hall toward the east wall at x = 37.
    charger.facing = { x: 1, y: 0 };
    session.monsterWindups.set(charger.id, -stats().windupMs);
    charger.action = "windingUp";

    const action = (): string => charger.action;
    while (action() !== "stunned" && clock.now < 3000) run(session, TICK_MS, clock);

    expect(action()).toBe("stunned");
    const stuckAt = charger.position.x;
    expect(stuckAt).toBeLessThan(37);
    expect(stuckAt).toBeGreaterThan(35);

    const stunnedFor = stats().charge!.stunMs;
    run(session, stunnedFor - TICK_MS * 3, clock);
    expect(action()).toBe("stunned");
    expect(charger.position.x).toBe(stuckAt);

    run(session, TICK_MS * 6, clock);
    expect(action()).not.toBe("stunned");
  });

  it("is stunned by a closed door as by a wall", () => {
    const charger = spawn("slag-charger", { x: 3, y: 2 });
    const session = hallSession([charger], { alpha: { x: 9, y: 3.4 } }, [
      { id: "d", position: { x: 7, y: 2 }, size: 1, open: false, lock: null },
    ]);
    charger.facing = { x: 1, y: 0 };
    session.monsterWindups.set(charger.id, -stats().windupMs);
    charger.action = "windingUp";

    run(session, 1200);

    expect(charger.action).toBe("stunned");
    expect(charger.position.x).toBeLessThan(7);
  });

  it("dashes only after the wind-up", () => {
    const charger = spawn("slag-charger", { x: 3, y: 2 });
    const session = hallSession([charger], { alpha: { x: 9, y: 2 } });
    windUpAndCharge(charger, session);
    expect(session.monsterCharges.has(charger.id)).toBe(true);
  });
});
