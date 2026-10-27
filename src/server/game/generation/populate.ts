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
 * A puzzle held by players gets plates for the party and a Ballast Stone for each hand it is short
 * of; an Idol Carry gets one altar plate and a Heavy Idol in the room farthest from it.
 */
import { ELITE_KEY_ITEM_ID } from "../../../shared/constants/game.js";
import { SEAT_FACING_VECTORS } from "../../../shared/constants/scenery.js";
import type { SeatFacing } from "../../../shared/constants/scenery.js";
import type {
  AltarState,
  ChestState,
  DoorState,
  ExitState,
  LightSourceState,
  LootState,
  MapSeat,
  MonsterState,
  PuzzleState,
  TrapState,
  Vector2,
} from "../../../shared/types/core.js";
import type { GameContent } from "../../content/loadContent.js";
import type { BiomeDefinition, RoomKind } from "../../content/schema.js";
import {
  BALLAST_ITEM_ID,
  IDOL_ITEM_ID,
  altarInstance,
  ballastNeeded,
  chestInstance,
  lootInstance,
  monsterInstance,
  doorVoteInstance,
  puzzleInstance,
  trapInstance,
} from "../dungeonBuilder.js";
import type { Rng } from "../random.js";
import { TWIN_LOCK_MIN_PARTY } from "../twinLocks.js";
import { NO_OMEN_EFFECTS, type OmenEffects } from "./omens.js";
import type { CarvedRoom, CarvedWorld } from "./carve.js";
import type { LayoutGraph } from "./layout.js";
import type { RoleAssignment } from "./roles.js";
import { midpointSockets, type RoomSide } from "./roomShapes.js";

const FLOOR = ".";

/** What opens the boss door when the key is not a puzzle's reward. */
export const BOSS_KEY_ITEM_ID = "boss-key";
/** What opens the vault door, and what its elite carries. */
export const VAULT_KEY_ITEM_ID = ELITE_KEY_ITEM_ID;
/** What an elite costs against its room's threat budget; it is placed even when the budget is short. */
export const ELITE_COST = 4;
/** An elite is drawn from the roster monsters no costlier than this, so it stays a fight a party can win. */
const ELITE_MAX_BASE_COST = 2;
/** Chest table for the boss room, and for any chest the design calls a vault chest. */
const BOSS_CHEST_TABLE = "vault-chest";
/** How often a vault's first chest is a Twin-lock Chest, for a party large enough to open one. */
const TWIN_LOCK_CHANCE = 0.5;
/** How often a chest in a hall, maze or trap room is a Mimic Chest. */
const MIMIC_CHANCE = 0.2;

/** Threat a room of each kind starts from, before depth and party size scale it. */
export const BASE_BUDGET: Readonly<Partial<Record<RoomKind, number>>> = { hall: 5, maze: 3, trap: 2, puzzle: 1, cavern: 4, arena: 7 };
/** Depth of a branch room, which has no place along the path. */
const BRANCH_DEPTH = 0.6;
/** Radius of a camp's fire. */
const CAMP_FIRE_RADIUS = 6;
/** The sides of a camp's fire that get a seat, four, enough for a full party; each faces the fire. */
const CAMP_SEAT_SIDES: readonly SeatFacing[] = ["south", "west", "north", "east"];
const CORRIDOR_TORCH_EVERY = 7;
const CORRIDOR_TORCH_OFFSET = 3;
const CORRIDOR_TORCH_RADIUS = 4.5;
/** Chance a corridor torch is lit, at an omen's `lightMult` of 1 or less. */
const CORRIDOR_TORCH_CHANCE = 0.7;
const CORRIDOR_TRAP_EVERY = 9;
const CORRIDOR_TRAP_OFFSET = 5;
/** Above this `lightMult` a room may gain a light beyond its base count. */
const BONUS_LIGHT_MULT = 1.2;
const MAX_PLATES: Readonly<Record<string, number>> = { "paired-levers": 2 };
const DEFAULT_MAX_PLATES = 3;
/** A Door Vote has a plate for each player, up to a full party, before every voted doorway. */
const MAX_VOTE_PLATES = 4;
/** How many skill scrolls a shrine altar offers. */
const ALTAR_OFFER_SIZE = 2;
/** Radius of a shrine's candle. */
const SHRINE_CANDLE_RADIUS = 4;

export interface PopulateInput {
  readonly graph: LayoutGraph;
  readonly plan: RoleAssignment;
  readonly world: CarvedWorld;
  readonly biome: BiomeDefinition;
  readonly content: GameContent;
  /** Players in the party, at least one. Scales every room's threat budget. */
  readonly partySize: number;
  /** What the run's omens do to this population. Neutral, so no omen changes nothing, when absent. */
  readonly omens?: OmenEffects;
  /** Skill ids of the scrolls the party carries. An altar never offers one of them. */
  readonly carriedSkillIds?: readonly string[];
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
  readonly altars: AltarState[];
  readonly traps: TrapState[];
  readonly puzzles: PuzzleState[];
  /** Somewhere to sit round each camp's fire. Empty when no room is a camp. */
  readonly seats: MapSeat[];
  /** One entry per layout node, indexed by node id. */
  readonly threat: readonly RoomThreat[];
}

/** How far along the run a room is: 0 at the entrance, 1 at the exit, and a fixed middle for branches. */
export function roomDepth(graph: LayoutGraph, nodeId: number): number {
  const node = graph.nodes[nodeId]!;
  return node.pathIndex >= 0 ? node.pathIndex / graph.pathLength : BRANCH_DEPTH;
}

/**
 * `base[kind] x (1 + 0.5 x depth) x (0.6 + 0.2 x partySize) x budgetMult`, rounded. Zero for kinds
 * with no base. `budgetMult` is the run's omen multiplier, 1 when there is none.
 */
export function threatBudget(kind: RoomKind, depth: number, partySize: number, budgetMult = 1): number {
  return Math.round((BASE_BUDGET[kind] ?? 0) * (1 + 0.5 * depth) * (0.6 + 0.2 * partySize) * budgetMult);
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

/** Kinds an idol never lies in: behind a lock, at the end of the run, or where the party arrives. */
const NO_IDOL_KINDS: readonly RoomKind[] = ["entrance", "boss", "exit", "vault"];

/**
 * The room an Idol Carry's idol lies in: the farthest by hops from the altar's room that is open to
 * the party before the boss, ties to the lower id. A layout with no such room falls back to the
 * entrance; validation still has to find the idol in reach.
 */
export function idolRoom(graph: LayoutGraph, plan: RoleAssignment, altarNodeId: number): number {
  const hops = new Array<number>(graph.nodes.length).fill(Infinity);
  hops[altarNodeId] = 0;
  const queue = [altarNodeId];
  for (let head = 0; head < queue.length; head += 1) {
    const id = queue[head]!;
    for (const edge of graph.edges) {
      const next = edge.a === id ? edge.b : edge.b === id ? edge.a : -1;
      if (next < 0 || hops[next] !== Infinity) continue;
      hops[next] = hops[id]! + 1;
      queue.push(next);
    }
  }
  const candidates = graph.nodes.filter(
    (node) => node.id !== altarNodeId && hops[node.id] !== Infinity && !NO_IDOL_KINDS.includes(plan.roles[node.id]!),
  );
  return candidates.sort((a, b) => hops[b.id]! - hops[a.id]! || a.id - b.id)[0]?.id ?? 0;
}

export function populateDungeon(rng: Rng, input: PopulateInput): Populated {
  const { graph, plan, world, biome, content, partySize } = input;
  const omens = input.omens ?? NO_OMEN_EFFECTS;
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
    altars: [] as AltarState[],
    traps: [] as TrapState[],
    puzzles: [] as PuzzleState[],
    seats: [] as MapSeat[],
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
      radius: Math.round(radius * biome.light * omens.radiusMult * 100) / 100,
      ...tint,
      ...extra,
    });
  };
  /**
   * A campfire light with a seat on each side of it, one tile out and facing it. A tile here is a
   * block of world tiles once the dungeon is scaled, so the seats stay inside the fire's glow.
   */
  const placeCampfire = (room: CarvedRoom, center: Vector2): void => {
    const fire = nearest(floorOf(room), center);
    addLight(fire, "Campfire", CAMP_FIRE_RADIUS, { fixture: "campfire", flicker: 0.5 });
    if (!fire) return;

    const open = new Set(floorOf(room).map(key));
    for (const facing of CAMP_SEAT_SIDES) {
      const toward = SEAT_FACING_VECTORS[facing];
      const tile = { x: fire.x - toward.x, y: fire.y - toward.y };
      if (!open.has(key(tile))) continue;
      claim(tile);
      out.seats.push({ id: rng.uuid(), x: tile.x, y: tile.y, facing });
    }
  };
  const lightCount = (base: number): number => {
    let count = 0;
    for (let index = 0; index < base; index += 1) {
      if (rng.chance(Math.min(1, biome.light * omens.lightMult * 0.85))) count += 1;
    }
    if (omens.lightMult > BONUS_LIGHT_MULT && rng.chance(omens.lightMult - 1)) count += 1;
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
  const dropChest = (room: CarvedRoom, tableId: string, chance: number, twinLock = false, mimicChance = 0): void => {
    if (!rng.chance(Math.min(1, chance + omens.chestBonus))) return;
    const nooks = floorOf(room).sort((a, b) => wallCount(b) - wallCount(a));
    const tile = claim(nooks[rng.int(0, Math.min(3, nooks.length - 1))] ?? null);
    if (!tile) return;
    const mimic = mimicChance > 0 && rng.chance(mimicChance);
    out.chests.push(chestInstance(requireTable(tableId).id, tile, rng.uuid(), false, twinLock, mimic));
  };

  // Doors first: the boss door sits in the boss room's own socket, so nothing else may land there.
  const bossRoom = world.rooms[plan.bossLock.to]!;
  const doorSocket = midpointSockets(bossRoom.width, bossRoom.height)[
    sideToward(graph, plan.bossLock.to, plan.bossLock.from)
  ].wall;
  const doorTile = claim({ x: bossRoom.x + doorSocket.x, y: bossRoom.y + doorSocket.y })!;
  out.doors.push({ id: rng.uuid(), position: { ...doorTile }, size: 1, open: false, lock: { type: "key", keyItemId: BOSS_KEY_ITEM_ID } });

  // The vault door, in the vault's own socket, opened only by the key an elite carries.
  if (plan.vault) {
    const vaultRoom = world.rooms[plan.vault.nodeId]!;
    const socket = midpointSockets(vaultRoom.width, vaultRoom.height)[
      sideToward(graph, plan.vault.nodeId, plan.vault.from)
    ].wall;
    const tile = claim({ x: vaultRoom.x + socket.x, y: vaultRoom.y + socket.y })!;
    out.doors.push({ id: rng.uuid(), position: { ...tile }, size: 1, open: false, lock: { type: "key", keyItemId: VAULT_KEY_ITEM_ID } });
  }

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
    } else if (kind === "camp") {
      placeCampfire(room, center);
    } else if (kind === "shrine") {
      addLight(nearest(floorOf(room), center), "Shrine Candle", SHRINE_CANDLE_RADIUS, { fixture: "candle" });
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
      // Beside the gate brazier rather than the room's middle, so the party arrives inside its light.
      const brazier = out.lightSources.find((light) => light.name === "Gate Brazier")?.position ?? center;
      const tiles = floorOf(room).sort((a, b) => distance(a, brazier) - distance(b, brazier) || byPosition(a, b));
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
    const budget = threatBudget(kind, depth, partySize, omens.budgetMult);
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
    if (plan.vault?.eliteNodeId === node.id) {
      const base = roster.filter((entry) => entry.cost <= ELITE_MAX_BASE_COST);
      const entry = rng.weighted(base.length > 0 ? base : roster);
      const tile = claim(rng.pick(floorOf(room)));
      if (!tile) throw new Error("No open floor left for the elite");
      out.monsters.push(monsterInstance(requireMonster(entry.typeId), tile, rng.uuid(), true));
      remaining = Math.max(0, remaining - ELITE_COST);
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

    // A vault holds one or two vault chests in its darkest nooks and nothing else: no lights, no guards.
    // With two or more players the first is sometimes a Twin-lock Chest; a solo party never sees one.
    if (kind === "vault") {
      const chests = rng.int(1, 2);
      const twinLock = partySize >= TWIN_LOCK_MIN_PARTY && rng.chance(TWIN_LOCK_CHANCE);
      for (let index = 0; index < chests; index += 1) dropChest(room, BOSS_CHEST_TABLE, 1, twinLock && index === 0);
    }

    // A shrine's altar offers two skill scrolls, picked by seed from those the party is not already
    // carrying. With fewer than two left there is nothing to choose between, so it stays bare.
    if (kind === "shrine") {
      const carried = new Set(input.carriedSkillIds ?? []);
      const scrolls = [...content.items.values()]
        .filter((item) => item.kind === "skillScroll" && !carried.has(item.skillId))
        .sort((a, b) => a.id.localeCompare(b.id));
      if (scrolls.length >= ALTAR_OFFER_SIZE) {
        const tile = claim(nearest(floorOf(room), { x: center.x, y: center.y - 1 }));
        const offer = rng.shuffle(scrolls).slice(0, ALTAR_OFFER_SIZE).map((item) => item.id);
        if (tile) out.altars.push(altarInstance(offer, tile, rng.uuid()));
      }
    }

    // Loot and chests by room kind.
    if (kind === "hall") {
      dropLoot(room, rng.int(0, 2));
      dropChest(room, biome.lootTableId, 0.3, false, MIMIC_CHANCE);
    } else if (kind === "maze") {
      dropLoot(room, rng.int(0, 1));
      dropChest(room, biome.lootTableId, 0.9, false, MIMIC_CHANCE);
    } else if (kind === "trap") {
      dropLoot(room, 1);
      dropChest(room, biome.lootTableId, 0.5, false, MIMIC_CHANCE);
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

    // An Idol Carry: the altar in the middle of its room and the idol in the room farthest from it,
    // so the party has to carry it the whole way. Any party size can, so it never needs a stone.
    if (type.heldBy === "idol") {
      const altar = claim(nearest(floorOf(room), centerOf(room)));
      if (!altar) throw new Error(`Room ${spec.nodeId} has no room for an altar`);
      out.puzzles.push(puzzleInstance(type, [altar], rng.uuid()));
      const vault = world.rooms[idolRoom(graph, plan, spec.nodeId)]!;
      const tile = claim(nearest(floorOf(vault), centerOf(vault)));
      if (!tile) throw new Error(`Room ${vault.nodeId} has no room for an idol`);
      out.loot.push(lootInstance(requireItem(IDOL_ITEM_ID), tile, rng.uuid()));
      continue;
    }
    const count = Math.max(2, Math.min(partySize, MAX_PLATES[spec.typeId] ?? DEFAULT_MAX_PLATES));
    const plates = spread(rng, floorOf(room), count).map((tile) => claim(tile)!);
    if (plates.length < count) throw new Error(`Room ${spec.nodeId} has no room for ${count} plates`);
    out.puzzles.push(puzzleInstance(type, plates, rng.uuid()));

    // A stone for each hand the party is short of, off the plates so it has to be carried onto one.
    const ballast = content.items.get(BALLAST_ITEM_ID);
    const stones = ballastNeeded(plates.length, partySize);
    if (stones > 0 && !ballast) throw new Error(`Populate needs the "${BALLAST_ITEM_ID}" item`);
    for (let index = 0; index < stones; index += 1) {
      const open = floorOf(room);
      const clear = open.filter((tile) => plates.every((plate) => distance(plate, tile) > type.plateRadius));
      const tile = claim(rng.shuffle(clear.length > 0 ? clear : open)[0] ?? null);
      if (!tile) throw new Error(`Room ${spec.nodeId} has no room for a Ballast Stone`);
      out.loot.push(lootInstance(ballast!, tile, rng.uuid()));
    }
  }

  // Corridor torches, every seventh tile, never on a socket where the door or a doorway stands. A
  // dark omen leaves some unlit; Brittle Floors drops a single-use trap every ninth tile.
  const corridorTrap = omens.corridorTrap === null ? null : content.traps.get(omens.corridorTrap);
  if (omens.corridorTrap !== null && !corridorTrap) throw new Error(`Populate needs unknown trap "${omens.corridorTrap}"`);
  for (const corridor of world.corridors) {
    corridor.tiles.forEach((tile, index) => {
      if (index === 0 || index === corridor.tiles.length - 1 || reserved.has(key(tile))) return;
      if (index % CORRIDOR_TORCH_EVERY === CORRIDOR_TORCH_OFFSET) {
        const lit = omens.lightMult >= 1 || rng.chance(Math.min(1, CORRIDOR_TORCH_CHANCE * omens.lightMult));
        if (lit) addLight(tile, "Corridor Torch", CORRIDOR_TORCH_RADIUS);
      } else if (corridorTrap && index % CORRIDOR_TRAP_EVERY === CORRIDOR_TRAP_OFFSET) {
        out.traps.push(trapInstance(corridorTrap, claim(tile)!, rng.uuid()));
      }
    });
  }

  // A Door Vote last, so a run without one draws exactly the stream it did before. Each voted
  // doorway is sealed and has a plate for every player in front of it. A junction too cramped for
  // every plate gets no vote at all, and its doorways stay open.
  const vote = plan.doorVote;
  const voteType = vote ? content.puzzles.get(vote.typeId) : undefined;
  if (vote && voteType && partySize >= voteType.minParty) {
    const room = world.rooms[vote.nodeId]!;
    const sockets = midpointSockets(room.width, room.height);
    const doorways = vote.doors.map((door) => {
      const side = sideToward(graph, vote.nodeId, door.toNodeId);
      const wallTile = { x: room.x + sockets[side].wall.x, y: room.y + sockets[side].wall.y };
      return { ...door, wallTile, inward: { x: room.x + sockets[side].inward.x, y: room.y + sockets[side].inward.y } };
    });
    // Every doorway the room has is a walkway; no plate stands on the tile just inside one.
    const walkways = new Set(
      used[vote.nodeId]!.map((side) => key({ x: room.x + sockets[side].inward.x, y: room.y + sockets[side].inward.y })),
    );
    const open = new Map<string, Vector2>();
    for (let y = room.y + 1; y < room.y + room.height - 1; y += 1) {
      for (let x = room.x + 1; x < room.x + room.width - 1; x += 1) {
        const tile = { x, y };
        if (!wall(x, y) && !reserved.has(key(tile)) && !walkways.has(key(tile))) open.set(key(tile), tile);
      }
    }
    const count = Math.min(partySize, MAX_VOTE_PLATES);
    const chosen: Vector2[][] = [];
    for (const doorway of doorways) {
      const plates = [...open.values()]
        .sort((a, b) => distance(a, doorway.inward) - distance(b, doorway.inward) || byPosition(a, b))
        .slice(0, count);
      for (const tile of plates) open.delete(key(tile));
      chosen.push(plates);
    }
    if (chosen.every((plates) => plates.length === count)) {
      const doors = doorways.map((doorway, index) => {
        const id = rng.uuid();
        out.doors.push({
          id,
          position: { ...claim(doorway.wallTile)! },
          size: 1,
          open: false,
          lock: { type: "seal", groupId: voteType.id },
        });
        for (const tile of chosen[index]!) claim(tile);
        return { doorId: id, icon: doorway.icon, plates: chosen[index]! };
      });
      out.puzzles.push(doorVoteInstance(voteType, doors, rng.uuid()));
    }
  }

  return { ...out, threat };
}
