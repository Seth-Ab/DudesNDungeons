import { describe, expect, it } from "vitest";
import { simulate } from "../../src/server/game/combat.js";
import { monsterStatsFor } from "../../src/server/game/dungeonState.js";
import { MONSTER_HEARING_RANGE, MONSTER_LEASH_MS } from "../../src/shared/constants/game.js";
import { coversTile, distance, tileAt, tileOf } from "../../src/shared/game/movement.js";
import type { DoorState, MonsterState, Vector2 } from "../../src/shared/types/core.js";
import type { Session } from "../../src/server/sessions/sessionStore.js";
import { testPlayer, testSession } from "./fixtures.js";

const TICK_MS = 50;

/** An L: a corridor along the top that turns down the right-hand side. */
const L_CORRIDOR = [
  "##############################",
  "#............................#",
  "#............................#",
  "#............................#",
  "#########################...##",
  "#########################...##",
  "#########################...##",
  "#########################...##",
  "#########################...##",
  "#########################...##",
  "#########################...##",
  "#########################...##",
  "#########################...##",
  "#########################...##",
  "##############################",
];

/** Two corridors that share a wall four tiles thick, the thickness of one authored wall. */
const PARALLEL = [
  "##############################",
  "#............................#",
  "#............................#",
  "#............................#",
  "##############################",
  "##############################",
  "##############################",
  "##############################",
  "#............................#",
  "#............................#",
  "#............................#",
  "##############################",
];

let monsterCounter = 0;

function imp(x: number, y: number): MonsterState {
  monsterCounter += 1;
  return {
    id: `00000000-0000-4000-8000-${String(monsterCounter).padStart(12, "0")}`,
    typeId: "ash-imp",
    name: "Ash Imp",
    position: { x, y },
    health: 12,
    maxHealth: 12,
    alive: true,
    boss: false,
  };
}

function door(x: number, y: number, size: number, open = false): DoorState {
  return { id: `door-${x}-${y}`, position: { x, y }, size, open, locked: false };
}

/** A session over a hand-drawn map, one world tile per character, holding only these bodies. */
function mapSession(
  rows: string[],
  monsters: MonsterState[],
  position: Vector2,
  doors: DoorState[] = [],
): Session {
  const session = testSession([testPlayer("alpha", { position })]);
  session.dungeon.map = {
    ...session.dungeon.map,
    width: rows[0]!.length,
    height: rows.length,
    originX: 0,
    originY: 0,
    tiles: rows,
  };
  session.dungeon.monsters = monsters;
  session.dungeon.doors = doors;
  session.dungeon.loot = [];
  session.dungeon.traps = [];
  session.dungeon.puzzles = [];
  return session;
}

function run(session: Session, ticks: number, clock = { now: 0 }, each?: () => void): void {
  for (let tick = 0; tick < ticks; tick += 1) {
    simulate(session, clock.now);
    clock.now += TICK_MS;
    each?.();
  }
}

const alpha = (session: Session) => session.players.get("alpha")!;

describe("monster pathing", () => {
  it("follows a player round a corner of an L-shaped corridor", () => {
    const session = mapSession(L_CORRIDOR, [imp(14, 2)], { x: 26, y: 2 });
    const clock = { now: 0 };
    const hunter = session.dungeon.monsters[0]!;

    // In plain sight along the top corridor, the imp notices the player.
    run(session, 4, clock);
    expect(hunter.position.x).toBeGreaterThan(14);

    // The player slips down the vertical leg, out of sight and still inside aggro range.
    alpha(session).position = { x: 26, y: 10 };
    expect(monsterStatsFor(hunter).aggroRange).toBeGreaterThan(
      distance(hunter.position, alpha(session).position),
    );

    run(session, 120, clock);

    expect(distance(hunter.position, alpha(session).position)).toBeLessThanOrEqual(
      monsterStatsFor(hunter).attackRange,
    );
    expect(alpha(session).health).toBeLessThan(100);
  });

  it("does not notice a player behind a wall beyond hearing range", () => {
    const session = mapSession(PARALLEL, [imp(5, 2)], { x: 5, y: 9 });
    const hunter = session.dungeon.monsters[0]!;
    const start = { ...hunter.position };
    const gap = distance(start, alpha(session).position);
    expect(gap).toBeGreaterThan(MONSTER_HEARING_RANGE);
    expect(gap).toBeLessThan(monsterStatsFor(hunter).aggroRange);

    run(session, 80);

    expect(hunter.position).toEqual(start);
    expect(alpha(session).health).toBe(100);
  });

  it("does notice a player close enough to hear through the wall", () => {
    // No route joins the two corridors, so the imp can only turn its attention, not walk to them.
    const session = mapSession(PARALLEL, [imp(5, 3)], { x: 5, y: 8 });
    const hunter = session.dungeon.monsters[0]!;
    expect(distance(hunter.position, alpha(session).position)).toBeLessThanOrEqual(
      MONSTER_HEARING_RANGE,
    );

    run(session, 2);

    expect(session.monsterPosts.get(hunter.id)?.engaged).toBe(true);
  });

  it("walks a leashed monster back to its spawn", () => {
    const session = mapSession(L_CORRIDOR, [imp(14, 2)], { x: 26, y: 2 });
    const clock = { now: 0 };
    const hunter = session.dungeon.monsters[0]!;
    const spawn = { ...hunter.position };

    run(session, 20, clock);
    const dragged = distance(hunter.position, spawn);
    expect(dragged).toBeGreaterThan(2);

    // Every player gone: nothing is in range any more.
    alpha(session).connected = false;
    const graceTicks = Math.floor(MONSTER_LEASH_MS / TICK_MS) - 2;
    const held = { ...hunter.position };
    run(session, graceTicks, clock);
    expect(hunter.position).toEqual(held);

    run(session, 6, clock);
    expect(distance(hunter.position, spawn)).toBeLessThan(dragged);

    run(session, 200, clock);
    expect(distance(hunter.position, spawn)).toBeLessThanOrEqual(0.25);
  });

  it("finds its own way home round a corner", () => {
    const session = mapSession(L_CORRIDOR, [imp(26, 4)], { x: 26, y: 12 });
    const clock = { now: 0 };
    const hunter = session.dungeon.monsters[0]!;
    const spawn = { ...hunter.position };

    run(session, 40, clock);
    expect(hunter.position.y).toBeGreaterThan(spawn.y + 2);

    alpha(session).connected = false;
    run(session, 400, clock);

    expect(distance(hunter.position, spawn)).toBeLessThanOrEqual(0.25);
  });

  it("never steps into a wall, a closed door, or another monster", () => {
    const door1 = door(10, 2, 3);
    const monsters = [imp(4, 1), imp(4, 2), imp(4, 3), imp(20, 1), imp(20, 3)];
    const session = mapSession(L_CORRIDOR, monsters, { x: 26, y: 2 }, [door1]);
    const clock = { now: 0 };

    run(session, 300, clock, () => {
      alpha(session).position = { x: 26, y: 2 };
      for (const monster of monsters) {
        const tile = tileOf(monster.position);
        expect(tileAt(session.dungeon.map, tile.x, tile.y)).toBe(".");
        expect(coversTile(door1, tile.x, tile.y)).toBe(false);
        for (const other of monsters) {
          if (other !== monster) {
            expect(distance(monster.position, other.position)).toBeGreaterThanOrEqual(0.69);
          }
        }
      }
    });
  });

  it("walks through a door once it is open", () => {
    const door1 = door(10, 2, 3);
    const hunter = imp(5, 2);
    const session = mapSession(L_CORRIDOR, [hunter], { x: 18, y: 2 }, [door1]);
    const clock = { now: 0 };

    run(session, 30, clock);
    expect(hunter.position.x).toBeLessThan(8.5);

    door1.open = true;
    run(session, 80, clock);

    expect(hunter.position.x).toBeGreaterThan(11.5);
  });
});
