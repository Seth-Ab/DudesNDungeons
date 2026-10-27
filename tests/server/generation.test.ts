import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import type { DelveDungeon } from "../../src/server/content/schema.js";
import type { BuiltDungeon } from "../../src/server/game/dungeonBuilder.js";
import { generateDungeon } from "../../src/server/game/dungeonGenerator.js";
import { validateDungeon } from "../../src/server/game/generation/validate.js";
import { buildDungeon, DEFAULT_DUNGEON_ID } from "../../src/server/game/dungeonState.js";
import { ELITE_HEALTH_MULT } from "../../src/shared/constants/game.js";
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
    for (let seed = 0; seed < 40; seed += 1) {
      const { dungeon } = generate(seed);
      const kinds = dungeon.rooms.map((room) => room.kind);

      // The critical path comes first in the room list: entrance, the rooms, boss, exit, then branches.
      expect(kinds[0]).toBe("entrance");
      expect(kinds.filter((kind) => kind === "exit")).toHaveLength(1);
      expect(kinds.filter((kind) => kind === "boss")).toHaveLength(1);
      expect(kinds.indexOf("boss") + 1).toBe(kinds.indexOf("exit"));
    }
  });

  it("gives every run a boss vault chest, which is where the Iron Will scroll can drop", () => {
    const vault = content.lootTables.get("vault-chest")!;
    const share = vault.entries.find((entry) => entry.itemId === "iron-will-scroll")!.weight /
      vault.entries.reduce((total, entry) => total + entry.weight, 0);
    expect(share).toBeGreaterThan(0);
    expect(share).toBeLessThan(0.25);

    for (let seed = 0; seed < 40; seed += 1) {
      const { dungeon } = generate(seed);
      const boss = dungeon.rooms.find((room) => room.kind === "boss")!;
      expect(
        dungeon.chests.some(
          (chest) =>
            chest.lootTableId === "vault-chest" &&
            coversRoom(boss, chest.position),
        ),
      ).toBe(true);
    }
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

  it("puts a way to open the boss door before it: a key on the floor or a puzzle's reward", () => {
    for (let seed = 0; seed < 120; seed += 1) {
      const { dungeon, spawnPoints } = generate(seed);
      const reachable = reachableFrom(dungeon, spawnPoints[0]!);
      const keys = dungeon.loot.filter((loot) => loot.kind === "key" && reachable.has(tileKey(loot.position)));
      const puzzles = dungeon.puzzles.filter((puzzle) => puzzle.plates.every((plate) => reachable.has(tileKey(plate.position))));

      expect(keys.length + puzzles.length).toBeGreaterThan(0);
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
      const base = content.monsters.get(monster.typeId)!.maxHealth;
      expect(monster.health).toBe(monster.elite ? Math.round(base * ELITE_HEALTH_MULT) : base);
    }
  });

  it("refuses a generated profile whose rooms cannot fit, rather than building a broken map", () => {
    const cramped = {
      id: "cramped",
      name: "Cramped",
      layout: "generated" as const,
      width: 20,
      height: 12,
      slots: [{ kinds: ["hall" as const], min: 1, max: 2 }],
      exitDestination: "hub",
    };

    expect(() => generateDungeon(cramped, content, 1, 4)).toThrow(/does not fit/);
  });
});

const coversRoom = (room: { x: number; y: number; width: number; height: number }, point: Vector2): boolean =>
  point.x >= room.x && point.x < room.x + room.width && point.y >= room.y && point.y < room.y + room.height;

const delveProfile = content.dungeons.get(DEFAULT_DUNGEON_ID) as DelveDungeon;
const PARTY_SIZES = [1, 2, 3, 4];

/** Ids and tiles flattened, so byte-identical is one string comparison. */
const fingerprint = (built: BuiltDungeon): string => JSON.stringify([built.dungeon, built.spawnPoints, built.seed]);

describe("a delve run's map theme", () => {
  it("is the theme its biome names, so each biome draws with its own palette", () => {
    const biome = content.biomes.get("cinder-depths")!;
    expect(generateDungeon(delveProfile, content, 7, 2).dungeon.map.theme).toBe(biome.theme);

    for (const theme of ["crypt", "fungal", "ossuary"] as const) {
      const themed = { ...content, biomes: new Map([["cinder-depths", { ...biome, theme }]]) };
      const { dungeon } = generateDungeon(delveProfile, themed, 7, 2);
      expect(dungeon.map.theme).toBe(theme);
      // Theme changes the picture and nothing else: the layout is the same seeded layout.
      expect(dungeon.map.tiles).toEqual(generateDungeon(delveProfile, content, 7, 2).dungeon.map.tiles);
    }
  });
});

describe("the delve generator", () => {
  it("is what the default run builds, and the Ember Vault stays the pinned authored map", () => {
    expect(delveProfile.layout).toBe("delve");
    expect(content.dungeons.get("ember-vault")?.layout).toBe("authored");
  });

  it("gives the same seed and party size byte-identical tiles and ids", () => {
    for (const partySize of PARTY_SIZES) {
      for (const seed of [0, 1, 357, 4242, 99999]) {
        const first = generateDungeon(delveProfile, content, seed, partySize);
        expect(fingerprint(generateDungeon(delveProfile, content, seed, partySize))).toBe(fingerprint(first));
      }
    }
  });

  it("places the new room kinds when a biome weights them, and the run still generates", () => {
    const biome = content.biomes.get(delveProfile.biomes[0]!)!;
    const weighted = {
      ...content,
      biomes: new Map(content.biomes).set(biome.id, {
        ...biome,
        roomWeights: { hall: 2, cavern: 2, arena: 2, camp: 2, shrine: 2 },
      }),
    };
    const kinds = new Set<string>();
    for (let seed = 0; seed < 12; seed += 1) {
      const built = generateDungeon(delveProfile, weighted, seed, 4);
      for (const room of built.dungeon.rooms) kinds.add(room.kind);
    }
    for (const kind of ["cavern", "arena", "camp", "shrine"]) expect(kinds).toContain(kind);
  });

  it("builds a different layout for different seeds", () => {
    const layouts = new Set<string>();
    for (let seed = 0; seed < 50; seed += 1) {
      layouts.add(generateDungeon(delveProfile, content, seed, 4).dungeon.map.tiles.join("\n"));
    }
    expect(layouts.size).toBeGreaterThan(45);
  });

  // About 2.4 ms alone, 2.2 without a Door Vote, which walks a run once for each door it could pick.
  // It counts this process's CPU time rather than the clock, because the suite runs files in
  // parallel and a loaded machine would otherwise decide the result.
  it("builds a run in well under 5 ms on average", () => {
    for (let seed = 0; seed < 20; seed += 1) generateDungeon(delveProfile, content, seed, 4);
    const runs = 300;
    const startedAt = process.cpuUsage();
    for (let seed = 0; seed < runs; seed += 1) generateDungeon(delveProfile, content, seed, 1 + (seed % 4));
    const spent = process.cpuUsage(startedAt);
    expect((spent.user + spent.system) / 1000 / runs).toBeLessThan(5);
  });

  it("retries a failed attempt from a new stream, and throws naming the seed when none works", () => {
    const failsOnce = (seed: number): boolean => {
      try {
        generateDungeon({ ...delveProfile, maxAttempts: 1 }, content, seed, 4);
        return false;
      } catch {
        return true;
      }
    };
    const seed = Array.from({ length: 200 }, (_, index) => index).find(failsOnce);
    // A seed one attempt cannot build is one the full profile still builds.
    expect(seed).toBeDefined();
    expect(() => generateDungeon(delveProfile, content, seed!, 4)).not.toThrow();
    expect(() => generateDungeon({ ...delveProfile, maxAttempts: 1 }, content, seed!, 4)).toThrow(
      new RegExp(`seed ${seed}\\b`),
    );
  });

  it("refuses a profile no flow of which the party can play", () => {
    const content2 = {
      ...content,
      flows: new Map([...content.flows].map(([id, flow]) => [id, { ...flow, minParty: 5 }])),
    };
    expect(() => generateDungeon(delveProfile, content2, 1, 4)).toThrow(/no flow a party of 4 can play/);
  });
});

describe("validation", () => {
  /** The first run from `from` up that `want` accepts, so a mutation starts from the shape it needs. */
  const firstRun = (want: (built: BuiltDungeon) => boolean): BuiltDungeon => {
    for (let seed = 0; seed < 200; seed += 1) {
      const built = generateDungeon(delveProfile, content, seed, 4);
      if (want(built)) return structuredClone(built);
    }
    throw new Error("no seed in range has the shape this test needs");
  };

  it("accepts an unmodified run", () => {
    expect(validateDungeon(firstRun(() => true), content, 4)).toEqual([]);
  });

  it("rejects a key placed inside the boss room", () => {
    // A run with no puzzle, since a solved puzzle's reward is a second way to a key.
    const built = firstRun((run) => run.dungeon.puzzles.length === 0);
    const boss = built.dungeon.rooms.find((room) => room.kind === "boss")!;
    const taken = new Set(
      [...built.dungeon.monsters, ...built.dungeon.loot, ...built.dungeon.chests, ...built.dungeon.traps, ...built.dungeon.doors].map(
        (entity) => `${entity.position.x},${entity.position.y}`,
      ),
    );
    let spot: Vector2 | undefined;
    for (let y = boss.y + 1; y < boss.y + boss.height - 1; y += 1) {
      for (let x = boss.x + 1; x < boss.x + boss.width - 1; x += 1) {
        if (built.dungeon.map.tiles[y]![x] === "." && !taken.has(`${x},${y}`)) spot = { x, y };
      }
    }
    expect(spot).toBeDefined();
    const [bossKey, ...spares] = built.dungeon.loot.filter((loot) => loot.kind === "key");
    expect(bossKey).toBeDefined();
    bossKey!.position = spot!;
    built.dungeon.loot = built.dungeon.loot.filter((loot) => !spares.includes(loot as (typeof spares)[number]));

    const errors = validateDungeon(built, content, 4);
    expect(errors).toContain("the exit is unreachable after every key and puzzle");
  });

  it("rejects a run whose locks were never placed", () => {
    const built = firstRun(() => true);
    built.dungeon.doors = [];

    expect(validateDungeon(built, content, 4)).toContain("the boss room is reachable with every lock closed");
  });

  it("rejects a puzzle needing more plates than the party can hold", () => {
    const built = firstRun((run) => run.dungeon.puzzles.some((puzzle) => puzzle.heldBy === "players"));
    // Two plates, no stones, and a party of one: the second plate has nobody to stand on it.
    built.dungeon.loot = built.dungeon.loot.filter((loot) => loot.kind !== "ballast");

    expect(validateDungeon(built, content, 1).join(" ")).toMatch(/plates held by 1 players and 0 stones/);
  });

  it("rejects an entity off the floor", () => {
    const built = firstRun((run) => run.dungeon.monsters.length > 0);
    built.dungeon.monsters[0]!.position = { x: 0, y: 0 };

    expect(validateDungeon(built, content, 4).join(" ")).toMatch(/monster is off the floor/);
  });
});

describe("generated puzzles", () => {
  it("places every puzzle's plates on reachable floor, clear of loot, with a reward in content", () => {
    let seen = 0;
    for (const seed of [1, 2, 3, 4, 5, 6, 7, 8]) {
      const { dungeon, spawnPoints } = generate(seed);
      const reachable = reachableFrom(dungeon, spawnPoints[0]!);
      for (const puzzle of dungeon.puzzles) {
        seen += 1;
        // An Idol Carry altar is a single plate; every other puzzle needs two hands at least.
        if (puzzle.heldBy === "idol") expect(puzzle.plates).toHaveLength(1);
        else expect(puzzle.plates.length).toBeGreaterThanOrEqual(2);
        expect(content.puzzles.has(puzzle.typeId)).toBe(true);
        for (const plate of puzzle.plates) {
          expect(isFloor(dungeon, plate.position)).toBe(true);
          expect(reachable.has(tileKey(plate.position))).toBe(true);
          expect(dungeon.loot.some((loot) => tileKey(loot.position) === tileKey(plate.position))).toBe(false);
        }
      }
    }
    expect(seen).toBeGreaterThan(0);
  });
});
