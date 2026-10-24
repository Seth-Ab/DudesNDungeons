/**
 * Stage 6 of the dungeon generator (decision 0016): populate.
 *
 * Takes the carved world and the roles and fills it, in the design's order: the boss door first, in
 * the boss room's own socket, then lights, spawn points, the exit, monsters from a threat budget,
 * the boss and its key, loot and chests by room kind, traps, puzzle plates, and corridor torches.
 * Every entity is built with the instance helpers in `dungeonBuilder.ts`, claims its own tile, and
 * lands on open floor away from the sockets a party walks through. Everything here is a pure
 * function of its inputs and the seeded stream, so a run replays exactly, ids included.
 *
 * Out of scope here: the session's party size reaching generation, and Ballast Stones for the
 * hands a puzzle is short of. A paired-levers puzzle always gets two plates.
 */
import type {
  ChestState,
  DoorState,
  ExitState,
  LightSourceState,
  LootState,
  MonsterState,
  PuzzleState,
  TrapState,
  Vector2,
} from "../../../shared/types/core.js";
import type { GameContent } from "../../content/loadContent.js";
import type { BiomeDefinition, RoomKind } from "../../content/schema.js";
import { chestInstance, lootInstance, monsterInstance, puzzleInstance, trapInstance } from "../dungeonBuilder.js";
import type { Rng } from "../random.js";
import type { CarvedRoom, CarvedWorld } from "./carve.js";
import type { LayoutGraph } from "./layout.js";
import type { RoleAssignment } from "./roles.js";
import { midpointSockets, type RoomSide } from "./roomShapes.js";

const FLOOR = ".";

/** What opens the boss door when the key is not a puzzle's reward. */
export const BOSS_KEY_ITEM_ID = "copper-key";
/** Chest table for the boss room, and for any chest the design calls a vault chest. */
const BOSS_CHEST_TABLE = "vault-chest";

/** Threat a room of each kind starts from, before depth and party size scale it. */
export const BASE_BUDGET: Readonly<Partial<Record<RoomKind, number>>> = { hall: 5, maze: 3, trap: 2, puzzle: 1 };
/** Depth of a branch room, which has no place along the path. */
const BRANCH_DEPTH = 0.6;
const CORRIDOR_TORCH_EVERY = 7;
const CORRIDOR_TORCH_OFFSET = 3;
const CORRIDOR_TORCH_RADIUS = 4.5;
const MAX_PLATES: Readonly<Record<string, number>> = { "paired-levers": 2 };
const DEFAULT_MAX_PLATES = 3;

export interface PopulateInput {
  readonly graph: LayoutGraph;
  readonly plan: RoleAssignment;
  readonly world: CarvedWorld;
  readonly biome: BiomeDefinition;
  readonly content: GameContent;
  /** Players in the party, at least one. Scales every room's threat budget. */
  readonly partySize: number;
}

export interface RoomThreat {
  readonly nodeId: number;
  readonly budget: number;
  /** Cost of the roster monsters placed, the guard included. The boss is outside the budget. */
  readonly spent: number;
}

export interface Populated {
  readonly doors: DoorState[];
  readonly lightSources: LightSourceState[];
  readonly spawnPoints: Vector2[];
  readonly exits: ExitState[];
  readonly monsters: MonsterState[];
  readonly loot: LootState[];
  readonly chests: ChestState[];
  readonly traps: TrapState[];
  readonly puzzles: PuzzleState[];
  /** One entry per layout node, indexed by node id. */
  readonly threat: readonly RoomThreat[];
}

/** How far along the run a room is: 0 at the entrance, 1 at the exit, and a fixed middle for branches. */
export function roomDepth(graph: LayoutGraph, nodeId: number): number {
  const node = graph.nodes[nodeId]!;
  return node.pathIndex >= 0 ? node.pathIndex / graph.pathLength : BRANCH_DEPTH;
}

/** `base[kind] x (1 + 0.5 x depth) x (0.6 + 0.2 x partySize)`, rounded. Zero for kinds with no base. */
export function threatBudget(kind: RoomKind, depth: number, partySize: number): number {
  return Math.round((BASE_BUDGET[kind] ?? 0) * (1 + 0.5 * depth) * (0.6 + 0.2 * partySize));
}

const key = (point: Vector2): string => `${point.x},${point.y}`;
const distance = (a: Vector2, b: Vector2): number => Math.hypot(a.x - b.x, a.y - b.y);
const byPosition = (a: Vector2, b: Vector2): number => a.y - b.y || a.x - b.x;

const SIDE_STEPS: readonly { readonly dc: number; readonly dr: number; readonly side: RoomSide }[] = [
  { dc: 1, dr: 0, side: "east" },
  { dc: -1, dr: 0, side: "west" },
  { dc: 0, dr: 1, side: "south" },
  { dc: 0, dr: -1, side: "north" },
];

const NEIGHBORS: readonly Vector2[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** The side of node `from` that faces node `to`, which must be a neighbouring cell. */
function sideToward(graph: LayoutGraph, from: number, to: number): RoomSide {
  const a = graph.nodes[from]!.cell;
  const b = graph.nodes[to]!.cell;
  const step = SIDE_STEPS.find((candidate) => candidate.dc === b.c - a.c && candidate.dr === b.r - a.r);
  if (!step) throw new Error(`Rooms ${from} and ${to} are not in neighbouring cells`);
  return step.side;
}

/** The nearest candidate to `point`, or null. Ties go to the earlier row, then column. */
function nearest(tiles: readonly Vector2[], point: Vector2): Vector2 | null {
  let best: Vector2 | null = null;
  for (const tile of tiles) {
    if (!best) best = tile;
    else {
      const gap = distance(tile, point) - distance(best, point);
      if (gap < 0 || (gap === 0 && byPosition(tile, best) < 0)) best = tile;
    }
  }
  return best;
}

/** Farthest-point sampling: spreads up to `count` picks across `tiles`, from one random first pick. */
function spread(rng: Rng, tiles: readonly Vector2[], count: number): Vector2[] {
  if (tiles.length === 0 || count <= 0) return [];
  const picks = [rng.pick(tiles)];
  while (picks.length < count && picks.length < tiles.length) {
    let best: Vector2 | null = null;
    let bestGap = -1;
    for (const tile of tiles) {
      const gap = Math.min(...picks.map((pick) => distance(pick, tile)));
      if (gap > bestGap) {
        best = tile;
        bestGap = gap;
      }
    }
    picks.push(best!);
  }
  return picks;
}

export function populateDungeon(rng: Rng, input: PopulateInput): Populated {
  const { graph, plan, world, biome, content, partySize } = input;
  if (!Number.isInteger(partySize) || partySize < 1) {
    throw new Error(`Populate needs a party of at least one, got ${partySize}`);
  }

  const wall = (x: number, y: number): boolean => (world.tiles[y]?.[x] ?? "#") !== FLOOR;
  const reserved = new Set<string>();
  const claim = (tile: Vector2 | null): Vector2 | null => {
    if (tile) reserved.add(key(tile));
    return tile;
  };

  // Sockets a corridor enters by, per room: the party walks these, so nothing is placed on them.
  const used: RoomSide[][] = graph.nodes.map(() => []);
  for (const edge of graph.edges) {
    used[edge.a]!.push(sideToward(graph, edge.a, edge.b));
    used[edge.b]!.push(sideToward(graph, edge.b, edge.a));
  }

  /** Open interior floor of a room, off its entrances. Falls back to all interior floor in a cramped room. */
  const floorOf = (room: CarvedRoom): Vector2[] => {
    const sockets = midpointSockets(room.width, room.height);
    const clear = new Set<string>();
    for (const side of used[room.nodeId]!) {
      const inward = sockets[side].inward;
      for (let dy = -1; dy <= 1; dy += 1) {
        for (let dx = -1; dx <= 1; dx += 1) clear.add(key({ x: room.x + inward.x + dx, y: room.y + inward.y + dy }));
      }
    }
    const open: Vector2[] = [];
    const cramped: Vector2[] = [];
    for (let y = room.y + 1; y < room.y + room.height - 1; y += 1) {
      for (let x = room.x + 1; x < room.x + room.width - 1; x += 1) {
        const tile = { x, y };
        if (wall(x, y) || reserved.has(key(tile))) continue;
        cramped.push(tile);
        if (!clear.has(key(tile))) open.push(tile);
      }
    }
    return open.length > 0 ? open : cramped;
  };

  const wallCount = (tile: Vector2): number => {
    let count = 0;
    for (let dy = -1; dy <= 1; dy += 1) {
      for (let dx = -1; dx <= 1; dx += 1) if (wall(tile.x + dx, tile.y + dy)) count += 1;
    }
    return count;
  };
  const wallHugging = (tiles: readonly Vector2[]): Vector2[] =>
    tiles.filter((tile) => NEIGHBORS.some((step) => wall(tile.x + step.x, tile.y + step.y)));
  const centerOf = (room: CarvedRoom): Vector2 => ({
    x: room.x + Math.floor(room.width / 2),
    y: room.y + Math.floor(room.height / 2),
  });
  const requireMonster = (typeId: string) => {
    const type = content.monsters.get(typeId);
    if (!type) throw new Error(`Populate needs unknown monster "${typeId}"`);
    return type;
  };
  const requireItem = (itemId: string) => {
    const item = content.items.get(itemId);
    if (!item) throw new Error(`Populate needs unknown item "${itemId}"`);
    return item;
  };
  const requireTable = (tableId: string) => {
    const table = content.lootTables.get(tableId);
    if (!table) throw new Error(`Populate needs unknown loot table "${tableId}"`);
    return table;
  };

  const out = {
    doors: [] as DoorState[],
    lightSources: [] as LightSourceState[],
    spawnPoints: [] as Vector2[],
    exits: [] as ExitState[],
    monsters: [] as MonsterState[],
    loot: [] as LootState[],
    chests: [] as ChestState[],
    traps: [] as TrapState[],
    puzzles: [] as PuzzleState[],
  };
  const threat: RoomThreat[] = [];

  const tint = biome.lightTint === "warm" ? {} : { tint: biome.lightTint };
  const addLight = (tile: Vector2 | null, name: string, radius: number, extra: Partial<LightSourceState> = {}): void => {
    if (!claim(tile)) return;
    out.lightSources.push({
      id: rng.uuid(),
      name,
      kind: "fixed",
      position: { ...tile! },
      radius: Math.round(radius * biome.light * 100) / 100,
      ...tint,
      ...extra,
    });
  };
  const lightCount = (base: number): number => {
    let count = 0;
    for (let index = 0; index < base; index += 1) if (rng.chance(Math.min(1, biome.light * 0.85))) count += 1;
    return count;
  };

  const consumables = requireTable(biome.lootTableId).entries;
  const dropLoot = (room: CarvedRoom, count: number): void => {
    for (let index = 0; index < count; index += 1) {
      const floor = floorOf(room);
      if (floor.length === 0) return;
      const tile = claim(rng.pick(floor))!;
      out.loot.push(lootInstance(requireItem(rng.weighted(consumables).itemId), tile, rng.uuid()));
    }
  };
  /** A chest in one of the room's deepest nooks, the floor tiles with the most walls round them. */
  const dropChest = (room: CarvedRoom, tableId: string, chance: number): void => {
    if (!rng.chance(chance)) return;
    const nooks = floorOf(room).sort((a, b) => wallCount(b) - wallCount(a));
    const tile = claim(nooks[rng.int(0, Math.min(3, nooks.length - 1))] ?? null);
    if (tile) out.chests.push(chestInstance(requireTable(tableId).id, tile, rng.uuid(), false));
  };

  // Doors first: the boss door sits in the boss room's own socket, so nothing else may land there.
  const bossRoom = world.rooms[plan.bossLock.to]!;
  const doorSocket = midpointSockets(bossRoom.width, bossRoom.height)[
    sideToward(graph, plan.bossLock.to, plan.bossLock.from)
  ].wall;
  const doorTile = claim({ x: bossRoom.x + doorSocket.x, y: bossRoom.y + doorSocket.y })!;
  out.doors.push({ id: rng.uuid(), position: { ...doorTile }, size: 1, open: false, locked: true });

  const roster = [...biome.roster];

  for (const node of graph.nodes) {
    const room = world.rooms[node.id]!;
    const kind = plan.roles[node.id]!;
    const depth = roomDepth(graph, node.id);
    const center = centerOf(room);

    // Lights.
    if (kind === "entrance") addLight(nearest(floorOf(room), center), "Gate Brazier", 7);
    else if (kind === "exit") addLight(nearest(floorOf(room), center), "Stair Beacon", 7);
    else if (kind === "boss") {
      addLight(nearest(floorOf(room), center), "Arena Fire", 7.5, { fixture: "campfire", flicker: 0.4 });
    } else if (kind === "hall") {
      for (const tile of spread(rng, wallHugging(floorOf(room)), lightCount(2))) addLight(tile, "Wall Torch", 5);
    } else if (kind === "maze") {
      for (const tile of spread(rng, wallHugging(floorOf(room)), lightCount(1))) addLight(tile, "Lost Lantern", 4.5);
    } else if (kind === "trap") {
      for (const tile of spread(rng, wallHugging(floorOf(room)), lightCount(1))) {
        addLight(tile, "Warning Lamp", 4.5, { tint: "red" });
      }
    }

    if (kind === "entrance") {
      const tiles = floorOf(room).sort((a, b) => distance(a, center) - distance(b, center) || byPosition(a, b));
      out.spawnPoints.push(...tiles.slice(0, 4).map((tile) => claim(tile)!));
    }

    if (kind === "exit") {
      const entry = midpointSockets(room.width, room.height)[used[node.id]![0]!].inward;
      const from = { x: room.x + entry.x, y: room.y + entry.y };
      const far = floorOf(room).sort((a, b) => distance(b, from) - distance(a, from) || byPosition(a, b))[0];
      const tile = claim(far ?? null);
      if (!tile) throw new Error("No open floor left for the exit");
      out.exits.push({ id: rng.uuid(), position: { ...tile }, destination: "hub", sealed: false });
    }

    // Monsters, from a threat budget that grows with depth and party size. A guardian spends the
    // most it can afford of it first, standing in the middle of the room it keeps the key in.
    const budget = threatBudget(kind, depth, partySize);
    let remaining = budget;
    const holdsKey = plan.bossKey.nodeId === node.id;
    if (holdsKey && plan.bossKey.via === "guardian") {
      const guard = roster.filter((entry) => entry.cost <= remaining).sort((a, b) => b.cost - a.cost)[0];
      const tile = guard ? claim(nearest(floorOf(room), center)) : null;
      if (guard && tile) {
        out.monsters.push(monsterInstance(requireMonster(guard.typeId), tile, rng.uuid()));
        remaining -= guard.cost;
      }
    }
    while (remaining > 0) {
      const affordable = roster.filter((entry) => entry.cost <= remaining);
      if (affordable.length === 0) break;
      const entry = rng.weighted(affordable);
      const floor = floorOf(room);
      if (floor.length === 0) break;
      const tile = claim(rng.pick(floor))!;
      out.monsters.push(monsterInstance(requireMonster(entry.typeId), tile, rng.uuid()));
      remaining -= entry.cost;
    }
    threat.push({ nodeId: node.id, budget, spent: budget - remaining });

    if (kind === "boss") {
      const tile = claim(nearest(floorOf(room), { x: center.x, y: center.y - 2 }));
      if (!tile) throw new Error("No open floor left for the boss");
      out.monsters.push(monsterInstance(requireMonster(rng.pick(biome.bosses)), tile, rng.uuid()));
      dropChest(room, BOSS_CHEST_TABLE, 1);
    }

    // The boss key, unless a puzzle's reward is the key: on the floor, as far from the way in as it goes.
    if (holdsKey && plan.bossKey.via !== "puzzle") {
      const far = floorOf(room).sort((a, b) => distance(b, center) - distance(a, center) || byPosition(a, b))[0];
      const tile = claim(far ?? null);
      if (tile) out.loot.push(lootInstance(requireItem(BOSS_KEY_ITEM_ID), tile, rng.uuid()));
    }

    // Loot and chests by room kind.
    if (kind === "hall") {
      dropLoot(room, rng.int(0, 2));
      dropChest(room, biome.lootTableId, 0.3);
    } else if (kind === "maze") {
      dropLoot(room, rng.int(0, 1));
      dropChest(room, biome.lootTableId, 0.9);
    } else if (kind === "trap") {
      dropLoot(room, 1);
      dropChest(room, biome.lootTableId, 0.5);
    }

    // Traps.
    const trapCount = kind === "trap" ? rng.int(3, 5) : kind === "hall" && rng.chance(0.25) ? 1 : 0;
    for (let index = 0; index < trapCount && biome.traps.length > 0; index += 1) {
      const floor = floorOf(room);
      if (floor.length === 0) break;
      const type = content.traps.get(rng.pick(biome.traps));
      if (!type) throw new Error("Populate needs a biome trap that is not in the catalog");
      out.traps.push(trapInstance(type, claim(rng.pick(floor))!, rng.uuid()));
    }
  }

  // Puzzle plates, spread across the room.
  for (const spec of plan.puzzles) {
    const type = content.puzzles.get(spec.typeId);
    if (!type) throw new Error(`Populate needs unknown puzzle "${spec.typeId}"`);
    const room = world.rooms[spec.nodeId]!;
    const count = Math.max(2, Math.min(partySize, MAX_PLATES[spec.typeId] ?? DEFAULT_MAX_PLATES));
    const plates = spread(rng, floorOf(room), count).map((tile) => claim(tile)!);
    if (plates.length < count) throw new Error(`Room ${spec.nodeId} has no room for ${count} plates`);
    out.puzzles.push(puzzleInstance(type, plates, rng.uuid()));
  }

  // Corridor torches, every seventh tile, never on a socket where the door or a doorway stands.
  for (const corridor of world.corridors) {
    corridor.tiles.forEach((tile, index) => {
      if (index === 0 || index === corridor.tiles.length - 1) return;
      if (index % CORRIDOR_TORCH_EVERY !== CORRIDOR_TORCH_OFFSET || reserved.has(key(tile))) return;
      addLight(tile, "Corridor Torch", CORRIDOR_TORCH_RADIUS);
    });
  }

  return { ...out, threat };
}
