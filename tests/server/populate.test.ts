import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import { carveDungeon, type CarvedWorld } from "../../src/server/game/generation/carve.js";
import { generateLayout, type LayoutGraph } from "../../src/server/game/generation/layout.js";
import {
  BOSS_KEY_ITEM_ID,
  ELITE_COST,
  idolRoom,
  populateDungeon,
  roomDepth,
  threatBudget,
  type Populated,
} from "../../src/server/game/generation/populate.js";
import { assignRoles, type RoleAssignment } from "../../src/server/game/generation/roles.js";
import { generateRoomShape, ROOM_SHAPE_IDS } from "../../src/server/game/generation/roomShapes.js";
import { createRng, mixSeed } from "../../src/server/game/random.js";

const GRID = { cols: 6, rows: 4 };
const CELL = { cell: 16, margin: 2 };
const SEEDS = 60;
const SIZES = [7, 9, 11];
const content = loadContent();
const biome = content.biomes.get("cinder-depths")!;
const flows = [...content.flows.values()];
const costOf = new Map(biome.roster.map((entry) => [entry.typeId, entry.cost]));

interface Run {
  graph: LayoutGraph;
  plan: RoleAssignment;
  world: CarvedWorld;
  populated: Populated;
}

function roll(seed: number, flow: (typeof flows)[number], partySize: number): Run | null {
  const rng = createRng(seed);
  const graph = generateLayout(rng, flow, GRID);
  if (!graph) return null;
  const plan = assignRoles(rng, graph, flow, biome);
  if (!plan) return null;
  const rooms = graph.nodes.map(() =>
    generateRoomShape(rng.pick(ROOM_SHAPE_IDS), rng.pick(SIZES), rng.pick(SIZES), rng).tiles,
  );
  const world = carveDungeon(createRng(mixSeed(seed, 5)), graph, rooms, CELL);
  if (!world) return null;
  const populated = populateDungeon(createRng(mixSeed(seed, 6)), { graph, plan, world, biome, content, partySize });
  return { graph, plan, world, populated };
}

function sweep(partySize: number): Run[] {
  const runs: Run[] = [];
  for (const flow of flows) {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      const run = roll(seed, flow, partySize);
      if (run) runs.push(run);
    }
  }
  expect(runs.length).toBeGreaterThan(flows.length * SEEDS * 0.2);
  return runs;
}

const key = (point: { x: number; y: number }): string => `${point.x},${point.y}`;

function roomAt(run: Run, point: { x: number; y: number }): number {
  return run.world.rooms.findIndex(
    (room) => point.x >= room.x && point.x < room.x + room.width && point.y >= room.y && point.y < room.y + room.height,
  );
}

describe("threatBudget", () => {
  it("grows with depth and with party size", () => {
    expect(threatBudget("hall", 1, 2)).toBeGreaterThan(threatBudget("hall", 0, 2));
    expect(threatBudget("hall", 0.5, 4)).toBeGreaterThan(threatBudget("hall", 0.5, 1));
    expect(threatBudget("maze", 0.5, 3)).toBeGreaterThanOrEqual(threatBudget("maze", 0.5, 2));
  });

  it("follows the design's formula and gives rooms with no base nothing", () => {
    expect(threatBudget("hall", 0, 1)).toBe(4);
    expect(threatBudget("hall", 1, 4)).toBe(Math.round(5 * 1.5 * 1.4));
    expect(threatBudget("entrance", 1, 4)).toBe(0);
    expect(threatBudget("boss", 1, 4)).toBe(0);
  });

  it("is larger in a deeper room of the same kind", () => {
    const run = sweep(2).find((candidate) => candidate.graph.nodes.some((node) => node.pathIndex === -1))!;
    expect(roomDepth(run.graph, run.graph.pathLength - 1)).toBeGreaterThan(roomDepth(run.graph, 1));
  });
});

describe("populateDungeon", () => {
  it("rejects a party with no players", () => {
    const run = roll(1, flows[0]!, 2) ?? roll(2, flows[0]!, 2)!;
    expect(() =>
      populateDungeon(createRng(1), { ...run, biome, content, partySize: 0 }),
    ).toThrow(/party/);
  });

  it("puts every entity on open floor and none on a shared tile", () => {
    for (const partySize of [1, 4]) {
      for (const run of sweep(partySize)) {
        const { populated, world } = run;
        const placed = [
          ...populated.monsters.map((entity) => entity.position),
          ...populated.loot.map((entity) => entity.position),
          ...populated.chests.map((entity) => entity.position),
          ...populated.traps.map((entity) => entity.position),
          ...populated.puzzles.flatMap((puzzle) => puzzle.plates.map((plate) => plate.position)),
          ...populated.exits.map((entity) => entity.position),
          ...populated.doors.map((entity) => entity.position),
          ...populated.lightSources.map((entity) => entity.position),
          ...populated.spawnPoints,
        ];
        for (const point of placed) expect(world.tiles[point.y]![point.x]).toBe(".");
        expect(new Set(placed.map(key)).size).toBe(placed.length);
        const ids = [
          ...populated.monsters,
          ...populated.loot,
          ...populated.chests,
          ...populated.traps,
          ...populated.puzzles,
          ...populated.exits,
          ...populated.doors,
          ...populated.lightSources,
        ].map((entity) => entity.id);
        expect(new Set(ids).size).toBe(ids.length);
      }
    }
  });

  it("never overspends a room's budget", () => {
    for (const run of sweep(3)) {
      const bossType = new Set(biome.bosses);
      const spent = new Map<number, number>();
      for (const monster of run.populated.monsters) {
        if (bossType.has(monster.typeId)) continue;
        const nodeId = roomAt(run, monster.position);
        const budget = threatBudget(run.plan.roles[nodeId]!, roomDepth(run.graph, nodeId), 3);
        const cost = monster.elite ? Math.min(ELITE_COST, budget) : costOf.get(monster.typeId)!;
        spent.set(nodeId, (spent.get(nodeId) ?? 0) + cost);
      }
      for (const room of run.populated.threat) {
        expect(room.spent).toBe(spent.get(room.nodeId) ?? 0);
        expect(room.spent).toBeLessThanOrEqual(room.budget);
        expect(room.budget).toBe(
          threatBudget(run.plan.roles[room.nodeId]!, roomDepth(run.graph, room.nodeId), 3),
        );
      }
    }
  });

  it("spends a larger budget in a larger party", () => {
    const total = (partySize: number): number =>
      sweep(partySize)
        .flatMap((run) => run.populated.threat)
        .reduce((sum, room) => sum + room.budget, 0);
    expect(total(4)).toBeGreaterThan(total(1));
  });

  it("lights the entrance and exit, and puts the boss in the boss room", () => {
    for (const run of sweep(2)) {
      const { populated, plan, graph } = run;
      const lit = (nodeId: number): boolean => populated.lightSources.some((light) => roomAt(run, light.position) === nodeId);
      expect(lit(0)).toBe(true);
      expect(lit(graph.pathLength)).toBe(true);
      const bossId = graph.pathLength - 1;
      expect(plan.roles[bossId]).toBe("boss");
      expect(lit(bossId)).toBe(true);
      const bosses = populated.monsters.filter((monster) => monster.boss);
      expect(bosses).toHaveLength(1);
      expect(roomAt(run, bosses[0]!.position)).toBe(bossId);
      expect(populated.exits).toHaveLength(1);
      expect(roomAt(run, populated.exits[0]!.position)).toBe(graph.pathLength);
      expect(populated.spawnPoints).toHaveLength(4);
      for (const spawn of populated.spawnPoints) expect(roomAt(run, spawn)).toBe(0);
    }
  });

  it("locks the boss room's own socket and holds the key somewhere reachable beyond the lock", () => {
    for (const run of sweep(2)) {
      const { populated, plan } = run;
      const door = populated.doors.find((candidate) => candidate.lock?.type === "key" && candidate.lock.keyItemId === BOSS_KEY_ITEM_ID)!;
      expect(populated.doors.filter((candidate) => candidate.lock?.type === "key" && candidate.lock.keyItemId === BOSS_KEY_ITEM_ID)).toHaveLength(1);
      expect(door.lock).toEqual({ type: "key", keyItemId: BOSS_KEY_ITEM_ID });
      const room = run.world.rooms[plan.bossLock.to]!;
      const onBorder =
        door.position.x === room.x ||
        door.position.x === room.x + room.width - 1 ||
        door.position.y === room.y ||
        door.position.y === room.y + room.height - 1;
      expect(onBorder).toBe(true);
      expect(roomAt(run, door.position)).toBe(plan.bossLock.to);

      const holder = plan.bossKey.nodeId;
      if (plan.bossKey.via === "puzzle") {
        expect(plan.puzzles.some((puzzle) => puzzle.nodeId === holder && puzzle.rewardsBossKey)).toBe(true);
      } else {
        const keys = populated.loot.filter((loot) => loot.name === content.items.get(BOSS_KEY_ITEM_ID)!.name);
        expect(keys).toHaveLength(1);
        expect(roomAt(run, keys[0]!.position)).toBe(holder);
      }
    }
  });

  it("gives every planned puzzle its plates in its room and a monster to a guarded key room", () => {
    for (const run of sweep(4)) {
      expect(run.populated.puzzles).toHaveLength(run.plan.puzzles.length);
      run.plan.puzzles.forEach((spec, index) => {
        const puzzle = run.populated.puzzles[index]!;
        expect(puzzle.typeId).toBe(spec.typeId);
        // Paired levers get two plates; an Idol Carry gets one altar, and its idol in another room.
        expect(puzzle.plates).toHaveLength(puzzle.heldBy === "idol" ? 1 : 2);
        for (const plate of puzzle.plates) expect(roomAt(run, plate.position)).toBe(spec.nodeId);
        if (puzzle.heldBy === "idol") {
          const idols = run.populated.loot.filter((loot) => loot.kind === "idol");
          expect(idols).toHaveLength(1);
          expect(roomAt(run, idols[0]!.position)).toBe(idolRoom(run.graph, run.plan, spec.nodeId));
          expect(idolRoom(run.graph, run.plan, spec.nodeId)).not.toBe(spec.nodeId);
        }
      });
      if (run.plan.bossKey.via === "guardian") {
        const guards = run.populated.monsters.filter((monster) => roomAt(run, monster.position) === run.plan.bossKey.nodeId);
        expect(guards.length).toBeGreaterThan(0);
      }
    }
  });

  it("never plans a puzzle that needs more plates held than players plus Ballast Stones", () => {
    for (let partySize = 1; partySize <= 4; partySize += 1) {
      for (const run of sweep(partySize)) {
        run.plan.puzzles.forEach((spec, index) => {
          const puzzle = run.populated.puzzles[index]!;
          const stones = run.populated.loot.filter(
            (loot) => loot.kind === "ballast" && roomAt(run, loot.position) === spec.nodeId,
          );
          expect(puzzle.plates.length).toBeLessThanOrEqual(partySize + stones.length);
          expect(stones.length).toBe(Math.max(0, puzzle.plates.length - partySize));
        });
      }
    }
  });

  it("keeps lights sparse: corridor torches sit seven tiles apart", () => {
    for (const run of sweep(2)) {
      const torches = run.populated.lightSources.filter((light) => light.name === "Corridor Torch");
      const expected = run.world.corridors.reduce(
        (sum, corridor) => sum + corridor.tiles.filter((_, index) => index > 0 && index < corridor.tiles.length - 1 && index % 7 === 3).length,
        0,
      );
      expect(torches).toHaveLength(expected);
      for (const light of run.populated.lightSources.filter((candidate) => candidate.name === "Warning Lamp")) {
        expect(light.tint).toBe("red");
      }
    }
  });

  it("is a pure function of the seed and party size, ids included", () => {
    for (const flow of flows) {
      for (let seed = 0; seed < 10; seed += 1) {
        const first = roll(seed, flow, 3);
        const second = roll(seed, flow, 3);
        expect(second?.populated).toEqual(first?.populated);
      }
    }
    const solo = roll(2, flows[0]!, 1);
    const full = roll(2, flows[0]!, 4);
    if (solo && full) expect(full.populated.monsters.length).toBeGreaterThanOrEqual(solo.populated.monsters.length);
  });
});
