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
      const built = generateDungeon({ ...delveProfile, flows: [flowId] }, content, seed, 2);
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
