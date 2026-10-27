import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import type { DelveDungeon } from "../../src/server/content/schema.js";
import type { BuiltDungeon } from "../../src/server/game/dungeonBuilder.js";
import { generateDungeon } from "../../src/server/game/dungeonGenerator.js";
import { DEFAULT_DUNGEON_ID } from "../../src/server/game/dungeonState.js";
import { TILE_SCALE } from "../../src/shared/constants/game.js";
import { validateDungeon } from "../../src/server/game/generation/validate.js";

/**
 * The seed sweep for the delve generator. Kept in its own file so Vitest runs it beside the rest of
 * the suite rather than after it: 4,000 runs at about a millisecond each.
 */
const content = loadContent();
const delveProfile = content.dungeons.get(DEFAULT_DUNGEON_ID) as DelveDungeon;
const PARTY_SIZES = [1, 2, 3, 4];
const SWEEP_SEEDS = 1000;

// Each sweep runs a thousand generations, close to vitest's 5 s default on a slow CI runner.
const SWEEP_TIMEOUT_MS = 30_000;

describe("the delve generator seed sweep", { timeout: SWEEP_TIMEOUT_MS }, () => {
  // The invariants that decide whether a run is finishable at all, swept rather than sampled: a
  // generator that only usually holds them ships an unplayable dungeon to somebody. Generation
  // already validates before returning, so this also proves no seed exhausts its attempts.
  it.each(PARTY_SIZES)("builds a finishable run for a party of %i over 1,000 seeds", (partySize) => {
    for (let seed = 0; seed < SWEEP_SEEDS; seed += 1) {
      const built = generateDungeon(delveProfile, content, seed, partySize);
      expect(validateDungeon(built, content, partySize), `seed ${seed}`).toEqual([]);
      expect(built.dungeon.rooms.filter((room) => room.kind === "boss")).toHaveLength(1);
      // The party arrives inside the entrance's light, not in the dark beside it. Radii are world
      // units and positions authored tiles, which `TILE_SCALE` world units span.
      const spawn = built.spawnPoints[0]!;
      const lit = built.dungeon.lightSources.some(
        (light) => Math.hypot(light.position.x - spawn.x, light.position.y - spawn.y) * TILE_SCALE <= light.radius,
      );
      expect(lit, `seed ${seed} spawn ${spawn.x},${spawn.y}`).toBe(true);
    }
  });

  it.each([...content.flows.keys()])("builds a finishable %s run for every party size", (flowId) => {
    for (const partySize of PARTY_SIZES) {
      for (let seed = 0; seed < 60; seed += 1) {
        const built = generateDungeon({ ...delveProfile, flows: [flowId] }, content, seed, partySize);
        expect(validateDungeon(built, content, partySize), `seed ${seed}`).toEqual([]);
      }
    }
  });
});

describe("vaults and the elite that carries their key", () => {
  const VAULT_SEEDS = 200;
  const inRoom = (room: BuiltDungeon["dungeon"]["rooms"][number], point: { x: number; y: number }): boolean =>
    point.x >= room.x && point.x < room.x + room.width && point.y >= room.y && point.y < room.y + room.height;

  /** Every vaulted run of a flow over `VAULT_SEEDS` seeds, for a party of two. */
  const cache = new Map<string, BuiltDungeon[]>();
  function vaulted(flowId: string): BuiltDungeon[] {
    const cached = cache.get(flowId);
    if (cached) return cached;
    const runs: BuiltDungeon[] = [];
    for (let seed = 0; seed < VAULT_SEEDS; seed += 1) {
      const built = generateDungeon({ ...delveProfile, flows: [flowId] }, content, seed, 2);
      if (built.dungeon.rooms.some((room) => room.kind === "vault")) runs.push(built);
    }
    cache.set(flowId, runs);
    return runs;
  }

  it.each([...content.flows.keys()])("builds a %s vault whose key is never inside it or behind its door", (flowId) => {
    const runs = vaulted(flowId);
    expect(runs.length).toBeGreaterThan(0);

    for (const built of runs) {
      const { dungeon } = built;
      const vault = dungeon.rooms.filter((room) => room.kind === "vault");
      expect(vault).toHaveLength(1);
      const room = vault[0]!;

      // One door in the vault's own wall, wanting the vault key.
      const doors = dungeon.doors.filter((door) => door.lock?.type === "key" && door.lock.keyItemId === "vault-key");
      expect(doors).toHaveLength(1);
      expect(inRoom(room, doors[0]!.position)).toBe(true);

      // The key is only ever carried: one elite, outside the vault, and none lying on the floor.
      const elites = dungeon.monsters.filter((monster) => monster.elite);
      expect(elites).toHaveLength(1);
      expect(inRoom(room, elites[0]!.position)).toBe(false);
      expect(dungeon.loot.filter((loot) => loot.kind === "key" && loot.itemId === "vault-key")).toEqual([]);
      const home = dungeon.rooms.find((candidate) => inRoom(candidate, elites[0]!.position))!;
      expect(["hall", "cavern", "maze", "arena"]).toContain(home.kind);

      // Darkness, one or two vault chests, and no guards.
      expect(dungeon.lightSources.filter((light) => inRoom(room, light.position))).toEqual([]);
      const chests = dungeon.chests.filter((chest) => inRoom(room, chest.position));
      expect(chests.length).toBeGreaterThanOrEqual(1);
      expect(chests.length).toBeLessThanOrEqual(2);
      expect(chests.every((chest) => chest.lootTableId === "vault-chest")).toBe(true);
      expect(dungeon.monsters.filter((monster) => inRoom(room, monster.position))).toEqual([]);

      expect(validateDungeon(built, content, 2)).toEqual([]);
    }
  }, 30_000);

  it("is rejected by validation when the key is carried inside the vault", () => {
    const [built] = vaulted("three-roads");
    expect(built).toBeDefined();
    const room = built!.dungeon.rooms.find((candidate) => candidate.kind === "vault")!;
    const elite = built!.dungeon.monsters.find((monster) => monster.elite)!;
    const spot = { x: room.x + Math.floor(room.width / 2), y: room.y + Math.floor(room.height / 2) };
    const moved: BuiltDungeon = {
      ...built!,
      dungeon: {
        ...built!.dungeon,
        monsters: built!.dungeon.monsters.map((monster) => (monster === elite ? { ...monster, position: spot } : monster)),
      },
    };

    expect(validateDungeon(moved, content, 2).length).toBeGreaterThan(0);
  });

  it("is rejected by validation when no elite carries the key", () => {
    const [built] = vaulted("three-roads");
    expect(built).toBeDefined();
    const plain: BuiltDungeon = {
      ...built!,
      dungeon: {
        ...built!.dungeon,
        monsters: built!.dungeon.monsters.map((monster) => ({ ...monster, elite: false })),
      },
    };

    expect(validateDungeon(plain, content, 2)).toContain(`room "${built!.dungeon.rooms.find((r) => r.kind === "vault")!.name}" is unreachable`);
  });

  it("is rejected by validation when the vault door was never placed", () => {
    const [built] = vaulted("three-roads");
    expect(built).toBeDefined();
    const open: BuiltDungeon = {
      ...built!,
      dungeon: {
        ...built!.dungeon,
        doors: built!.dungeon.doors.filter((door) => !(door.lock?.type === "key" && door.lock.keyItemId === "vault-key")),
      },
    };

    expect(validateDungeon(open, content, 2)).toContain("the vault room is reachable with every lock closed");
  });
});

describe("how often a run has a vault", () => {
  const SEEDS = 500;
  const vaultRuns = (flowId: string, seeds: number): number => {
    let count = 0;
    for (let seed = 0; seed < seeds; seed += 1) {
      const built = generateDungeon({ ...delveProfile, flows: [flowId] }, content, seed, 2, { vote: false });
      if (built.dungeon.rooms.some((room) => room.kind === "vault")) count += 1;
    }
    return count;
  };

  it.each([...content.flows.values()])("matches the vaultChance of $id", (flow) => {
    const rate = vaultRuns(flow.id, SEEDS) / SEEDS;
    expect(Math.abs(rate - flow.vaultChance), `${flow.id} built a vault in ${rate} of runs`).toBeLessThan(0.07);
  }, 30_000);

  it("builds no vault when the flow never rolls one", () => {
    const never = { ...delveProfile, flows: ["gauntlet"] };
    const flows = new Map(content.flows);
    flows.set("gauntlet", { ...flows.get("gauntlet")!, vaultChance: 0 });
    for (let seed = 0; seed < 100; seed += 1) {
      const built = generateDungeon(never, { ...content, flows }, seed, 2);
      expect(built.dungeon.rooms.some((room) => room.kind === "vault")).toBe(false);
      expect(built.dungeon.monsters.some((monster) => monster.elite)).toBe(false);
    }
  });
});

describe("the Twin-lock Chest", () => {
  const SEEDS = 300;
  const inRoom = (room: BuiltDungeon["dungeon"]["rooms"][number], point: { x: number; y: number }): boolean =>
    point.x >= room.x && point.x < room.x + room.width && point.y >= room.y && point.y < room.y + room.height;
  const runs = (partySize: number): BuiltDungeon[] =>
    Array.from({ length: SEEDS }, (_, seed) => generateDungeon(delveProfile, content, seed, partySize));
  const twinLocked = (built: BuiltDungeon) => built.dungeon.chests.filter((chest) => chest.twinLock);

  it("never appears for a solo party", () => {
    for (const built of runs(1)) expect(twinLocked(built)).toEqual([]);
  });

  it.each([2, 3, 4])("appears in some vaults for a party of %i, one at most, and every run validates", (partySize) => {
    let vaults = 0;
    let found = 0;
    for (const built of runs(partySize)) {
      const vault = built.dungeon.rooms.find((room) => room.kind === "vault");
      const locks = twinLocked(built);
      if (vault) vaults += 1;
      found += locks.length;
      expect(locks.length).toBeLessThanOrEqual(1);
      for (const chest of locks) {
        expect(vault && inRoom(vault, chest.position)).toBe(true);
        expect(chest).toMatchObject({ lootTableId: "vault-chest", locked: false, opened: false, keyTurnedBy: null });
      }
      expect(validateDungeon(built, content, partySize)).toEqual([]);
    }
    // About half of all vaults, well clear of none and all.
    expect(found).toBeGreaterThan(vaults * 0.3);
    expect(found).toBeLessThan(vaults * 0.7);
  }, 30_000);

  const firstTwinLocked = (): BuiltDungeon => {
    const built = runs(2).find((run) => twinLocked(run).length > 0);
    expect(built).toBeDefined();
    return built!;
  };

  it("is rejected by validation for a party too small to open it", () => {
    expect(validateDungeon(firstTwinLocked(), content, 1)).toContain("a twin-lock chest needs 2 players, not 1");
  });

  it("is rejected by validation when no one can reach it", () => {
    const built = firstTwinLocked();
    // Without an elite there is no vault key, so the vault and the chest in it stay shut.
    const keyless: BuiltDungeon = {
      ...built,
      dungeon: { ...built.dungeon, monsters: built.dungeon.monsters.map((monster) => ({ ...monster, elite: false })) },
    };
    const chest = twinLocked(built)[0]!;

    expect(validateDungeon(keyless, content, 2)).toContain(
      `the twin-lock chest at ${chest.position.x},${chest.position.y} cannot be reached`,
    );
  });
});

describe("the Idol Carry", () => {
  const SEEDS = 200;
  const inRoom = (room: BuiltDungeon["dungeon"]["rooms"][number], point: { x: number; y: number }): boolean =>
    point.x >= room.x && point.x < room.x + room.width && point.y >= room.y && point.y < room.y + room.height;
  /** The gauntlet keeps its boss key behind a puzzle; this biome only ever draws the Idol Carry. */
  const idolOnly = (() => {
    const biomes = new Map(content.biomes);
    biomes.set("cinder-depths", { ...biomes.get("cinder-depths")!, puzzles: ["idol-carry"] });
    return { ...content, biomes };
  })();
  const gauntlet = { ...delveProfile, flows: ["gauntlet"] };
  const run = (seed: number, partySize: number): BuiltDungeon => generateDungeon(gauntlet, idolOnly, seed, partySize);

  it.each(PARTY_SIZES)("builds a finishable run for a party of %i, the idol far from its altar", (partySize) => {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const built = run(seed, partySize);
      const { dungeon } = built;
      const altars = dungeon.puzzles.filter((puzzle) => puzzle.heldBy === "idol");
      expect(altars, `seed ${seed}`).toHaveLength(1);
      const altar = altars[0]!;
      expect(altar).toMatchObject({ typeId: "idol-carry", phase: "idle", progress: 0 });
      expect(altar.plates).toHaveLength(1);

      const idols = dungeon.loot.filter((loot) => loot.kind === "idol");
      expect(idols).toHaveLength(1);
      const altarRoom = dungeon.rooms.find((room) => inRoom(room, altar.plates[0]!.position))!;
      const idolRoom = dungeon.rooms.find((room) => inRoom(room, idols[0]!.position))!;
      expect(idolRoom).not.toBe(altarRoom);
      expect(["entrance", "boss", "exit", "vault"]).not.toContain(idolRoom.kind);
      // Any party carries one idol, so an altar never needs a stone.
      expect(dungeon.loot.filter((loot) => loot.kind === "ballast")).toEqual([]);

      expect(validateDungeon(built, idolOnly, partySize), `seed ${seed}`).toEqual([]);
    }
  }, 30_000);

  it.each(PARTY_SIZES)("turns up in shipped runs for a party of %i", (partySize) => {
    let found = 0;
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const built = generateDungeon(gauntlet, content, seed, partySize);
      if (built.dungeon.puzzles.some((puzzle) => puzzle.heldBy === "idol")) found += 1;
    }
    // About half of all gauntlets, one of two puzzles the biome draws from.
    expect(found).toBeGreaterThan(SEEDS * 0.3);
    expect(found).toBeLessThan(SEEDS * 0.7);
  }, 30_000);

  it("is rejected by validation when the idol is missing", () => {
    const built = run(0, 1);
    built.dungeon.loot = built.dungeon.loot.filter((loot) => loot.kind !== "idol");

    const errors = validateDungeon(built, idolOnly, 1);
    expect(errors).toContain("puzzle idol-carry has no idol in reach");
    expect(errors).toContain("the exit is unreachable after every key and puzzle");
  });

  it("is rejected by validation when the idol lies behind the boss door", () => {
    const built = run(0, 2);
    const boss = built.dungeon.rooms.find((room) => room.kind === "boss")!;
    const idol = built.dungeon.loot.find((loot) => loot.kind === "idol")!;
    const taken = new Set(built.dungeon.monsters.map((monster) => `${monster.position.x},${monster.position.y}`));
    let spot: { x: number; y: number } | undefined;
    for (let y = boss.y + 1; y < boss.y + boss.height - 1 && !spot; y += 1) {
      for (let x = boss.x + 1; x < boss.x + boss.width - 1 && !spot; x += 1) {
        const free =
          built.dungeon.map.tiles[y]?.[x] === "." &&
          !taken.has(`${x},${y}`) &&
          !built.dungeon.loot.some((loot) => loot.position.x === x && loot.position.y === y) &&
          !built.dungeon.chests.some((chest) => chest.position.x === x && chest.position.y === y) &&
          !built.dungeon.lightSources.some((light) => light.position.x === x && light.position.y === y);
        if (free) spot = { x, y };
      }
    }
    expect(spot).toBeDefined();
    idol.position = spot!;

    expect(validateDungeon(built, idolOnly, 2)).toContain("puzzle idol-carry has no idol in reach");
  });

  it("is rejected by validation when one idol has to serve two altars", () => {
    const built = run(0, 3);
    const altar = built.dungeon.puzzles.find((puzzle) => puzzle.heldBy === "idol")!;
    const idol = built.dungeon.loot.find((loot) => loot.kind === "idol")!;
    // The idol steps one free floor tile aside, and a second altar takes the tile it lay on: both
    // altars are in reach, but the first one solved keeps the only idol.
    const entities = [...built.dungeon.loot, ...built.dungeon.monsters, ...built.dungeon.chests, ...built.dungeon.traps];
    const aside = [-1, 1]
      .flatMap((d) => [{ x: idol.position.x + d, y: idol.position.y }, { x: idol.position.x, y: idol.position.y + d }])
      .find(
        (point) =>
          built.dungeon.map.tiles[point.y]?.[point.x] === "." &&
          !entities.some((entity) => entity.position.x === point.x && entity.position.y === point.y),
      );
    expect(aside).toBeDefined();
    built.dungeon.puzzles.push({
      ...altar,
      id: "e0000000-0000-4000-8000-000000000000",
      plates: [{ position: { ...idol.position }, held: false }],
    });
    idol.position = aside!;

    expect(validateDungeon(built, idolOnly, 3)).toContain("puzzle idol-carry has no idol in reach");
  });
});

describe("the Door Vote seed sweep", { timeout: SWEEP_TIMEOUT_MS }, () => {
  const VOTE_SEEDS = 300;

  // The vote seals doorways for good, so the sweep that proves a run finishable must hold it to the
  // constraint that matters: whichever door a party picks, the exit stays reachable. Validation
  // walks every choice, so a clean sweep over runs that asked for a vote is that proof.
  it.each([2, 3, 4])("builds a finishable run for every door a party of %i could pick", (partySize) => {
    let votes = 0;
    for (let seed = 0; seed < VOTE_SEEDS; seed += 1) {
      const built = generateDungeon(delveProfile, content, seed, partySize, { vote: true });
      expect(validateDungeon(built, content, partySize), `seed ${seed}`).toEqual([]);
      const vote = built.dungeon.puzzles.find((puzzle) => puzzle.heldBy === "doors");
      if (!vote) {
        // A run holds out for a junction, then builds without rather than fail: no seal is left over.
        expect(built.dungeon.doors.some((door) => door.lock?.type === "seal"), `seed ${seed}`).toBe(false);
        continue;
      }
      votes += 1;
      const sealed = built.dungeon.doors.filter((door) => door.lock?.type === "seal");
      expect(sealed.map((door) => door.id).sort(), `seed ${seed}`).toEqual(
        [...new Set(vote.plates.map((plate) => plate.doorId))].sort(),
      );
    }
    // A good share of vote runs find a junction within their attempts; the rest fall back to a plain run.
    expect(votes).toBeGreaterThan(VOTE_SEEDS / 4);
  });

  it("is absent for a party of one, and whenever a run does not ask for it", () => {
    for (let seed = 0; seed < 150; seed += 1) {
      for (const [partySize, vote] of [[1, true], [3, false]] as const) {
        const built = generateDungeon(delveProfile, content, seed, partySize, { vote });
        expect(built.dungeon.puzzles.some((puzzle) => puzzle.heldBy === "doors"), `seed ${seed}`).toBe(false);
      }
    }
  });
});
