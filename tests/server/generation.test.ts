import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import { buildDungeon, DEFAULT_DUNGEON_ID } from "../../src/server/game/dungeonState.js";
import { coversTile, isFloor, tileOf } from "../../src/shared/game/movement.js";
import type { DungeonState, Vector2 } from "../../src/shared/types/core.js";

const content = loadContent();

function generate(seed: number) {
  return buildDungeon({ dungeonId: DEFAULT_DUNGEON_ID, seed, content });
}

const tileKey = (position: Vector2): string => {
  const tile = tileOf(position);
  return `${tile.x},${tile.y}`;
};

/**
 * Flood fills the floor from `start`, so a test can assert what a party can actually walk to.
 *
 * Walks world tiles, not authored ones. Entities sit at the centre of their authored block, which is
 * a half-integer in world coordinates, so every position is put on its tile before it is compared.
 */
function reachableFrom(dungeon: DungeonState, start: Vector2): Set<string> {
  const from = tileOf(start);
  const seen = new Set<string>([tileKey(from)]);
  const queue: Vector2[] = [from];

  while (queue.length > 0) {
    const { x, y } = queue.shift()!;
    for (const step of [
      { x: x + 1, y },
      { x: x - 1, y },
      { x, y: y + 1 },
      { x, y: y - 1 },
    ]) {
      const key = `${step.x},${step.y}`;
      if (seen.has(key) || !isFloor(dungeon, step)) continue;

      // A closed door blocks a walk the same way a wall does, across its whole span.
      const blocked = dungeon.doors.some((door) => !door.open && coversTile(door, step.x, step.y));
      if (blocked) continue;

      seen.add(key);
      queue.push(step);
    }
  }

  return seen;
}

describe("generated dungeons", () => {
  it("replays exactly from the same seed, and differs across seeds", () => {
    expect(generate(4242).dungeon).toEqual(generate(4242).dungeon);
    expect(generate(4242).dungeon).not.toEqual(generate(4243).dungeon);
  });

  it("reports the seed it was built from, so a run can be reproduced from a bug report", () => {
    expect(generate(777).seed).toBe(777);
    // An authored dungeon has no seed: it is the same every time by construction.
    expect(buildDungeon({ dungeonId: "ember-vault", content }).seed).toBeNull();
  });

  it("runs from an entrance to an exit, with a boss room on the way", () => {
    const { dungeon } = generate(11);
    const kinds = dungeon.rooms.map((room) => room.kind);

    expect(kinds[0]).toBe("entrance");
    expect(kinds[kinds.length - 1]).toBe("exit");
    expect(kinds).toContain("boss");
    expect(kinds).toContain("puzzle");
  });

  it("never overlaps two rooms", () => {
    const { dungeon } = generate(31);

    for (const room of dungeon.rooms) {
      for (const other of dungeon.rooms) {
        if (room === other) continue;

        const apart =
          room.x + room.width <= other.x ||
          other.x + other.width <= room.x ||
          room.y + room.height <= other.y ||
          other.y + other.height <= room.y;
        expect(apart).toBe(true);
      }
    }
  });

  it("keeps every spawn point on open floor", () => {
    for (let seed = 0; seed < 120; seed += 1) {
      const { dungeon, spawnPoints } = generate(seed);

      expect(spawnPoints.length).toBeGreaterThan(0);
      for (const point of spawnPoints) expect(isFloor(dungeon, point)).toBe(true);
    }
  });

  // Swept across many seeds rather than one: these are the two properties that decide whether a
  // generated run is finishable at all, and a generator that only usually holds them is a generator
  // that ships an unplayable dungeon to somebody.
  it("connects the exit to the spawn, once the locked door is open", () => {
    for (let seed = 0; seed < 120; seed += 1) {
      const { dungeon, spawnPoints } = generate(seed);
      const exit = dungeon.exits[0]!;

      // Locked shut, the exit is walled off: that is what makes the key worth finding.
      const sealed = reachableFrom(dungeon, spawnPoints[0]!);
      expect(sealed.has(tileKey(exit.position))).toBe(false);

      // Opened, it is reachable on foot, so a party that finds the key can always finish the run.
      const opened = { ...dungeon, doors: dungeon.doors.map((door) => ({ ...door, open: true })) };
      const reachable = reachableFrom(opened, spawnPoints[0]!);
      expect(reachable.has(tileKey(exit.position))).toBe(true);
    }
  });

  it("places a key somewhere reachable before the locked door", () => {
    for (let seed = 0; seed < 120; seed += 1) {
      const { dungeon, spawnPoints } = generate(seed);
      const reachable = reachableFrom(dungeon, spawnPoints[0]!);
      const keys = dungeon.loot.filter((loot) => loot.kind === "key");

      expect(keys.length).toBeGreaterThan(0);
      expect(
        keys.some((key) => reachable.has(tileKey(key.position))),
      ).toBe(true);
    }
  });

  it("puts every entity on floor, and never two on one tile", () => {
    const { dungeon } = generate(64);
    const occupied = new Set<string>();

    for (const entity of [...dungeon.monsters, ...dungeon.loot]) {
      const key = `${entity.position.x},${entity.position.y}`;
      expect(isFloor(dungeon, entity.position)).toBe(true);
      expect(occupied.has(key)).toBe(false);
      occupied.add(key);
    }
  });

  it("keys monsters by type id, so stats survive two monsters sharing a name", () => {
    const { dungeon } = generate(88);

    expect(dungeon.monsters.length).toBeGreaterThan(0);
    for (const monster of dungeon.monsters) {
      expect(content.monsters.has(monster.typeId)).toBe(true);
      expect(monster.health).toBe(content.monsters.get(monster.typeId)!.maxHealth);
    }
  });

  it("refuses a profile whose rooms cannot fit, rather than building a broken map", () => {
    const cramped = {
      ...content.dungeons.get(DEFAULT_DUNGEON_ID)!,
      width: 20,
      height: 12,
    };
    const tiny = new Map(content.dungeons);
    tiny.set(DEFAULT_DUNGEON_ID, cramped);

    expect(() =>
      buildDungeon({ dungeonId: DEFAULT_DUNGEON_ID, seed: 1, content: { ...content, dungeons: tiny } }),
    ).toThrow(/does not fit/);
  });
});
