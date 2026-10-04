import type {
  DoorState,
  ExitState,
  LightSourceState,
  LootState,
  MonsterState,
  RoomState,
  PuzzleState,
  TrapState,
  Vector2,
} from "../../shared/types/core.js";
import type { GameContent } from "../content/loadContent.js";
import type { Doorway, GeneratedDungeon, RoomKind, RoomTemplate } from "../content/schema.js";
import { lootInstance, monsterInstance, puzzleInstance, trapInstance, type BuiltDungeon } from "./dungeonBuilder.js";
import { createRng, type Rng } from "./random.js";

/**
 * Stitches room templates into a dungeon.
 *
 * Everything here is a pure function of the seed, so the same seed always builds the same dungeon.
 * That is what lets a test assert on a generated run and a bug found in play be reproduced from the
 * seed alone. Nothing in this file calls `Math.random`.
 *
 * The shape of a run is a chain: entrance, then each slot from the profile in order, then the exit.
 * Consecutive rooms are joined by an L-shaped corridor between their facing doorways, so the chain
 * is connected by construction and the exit is always reachable.
 *
 * Everything here works in authored tiles, where a corridor is one tile wide and the search for a
 * route between rooms is small enough to run per corridor. `scaleDungeon` blows the finished result
 * up to world scale afterwards, which is what turns that one-tile corridor into one four players
 * can walk abreast.
 */

/** Empty tiles between placed rooms. Enough that corridors read as corridors rather than as seams. */
const ROOM_PADDING = 3;

/**
 * Gap between a room and the edge of the world. Two, not one: a doorway on a room's outer wall needs
 * a tile outside it to open onto, and the grid's outer ring is kept solid.
 */
const WORLD_MARGIN = 2;

const WALL = "#";
const FLOOR = ".";

interface PlacedRoom {
  template: RoomTemplate;
  /** Top-left tile of the template in world coordinates. */
  origin: Vector2;
  state: RoomState;
}

class TileGrid {
  readonly rows: string[][];

  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    this.rows = Array.from({ length: height }, () => Array.from({ length: width }, () => WALL));
  }

  inBounds(x: number, y: number): boolean {
    return x >= 0 && y >= 0 && x < this.width && y < this.height;
  }

  set(x: number, y: number, tile: string): void {
    if (this.inBounds(x, y)) this.rows[y]![x] = tile;
  }

  get(x: number, y: number): string {
    return this.inBounds(x, y) ? this.rows[y]![x]! : WALL;
  }

  toTiles(): string[] {
    return this.rows.map((row) => row.join(""));
  }
}

function centerOf(room: PlacedRoom): Vector2 {
  return {
    x: room.origin.x + Math.floor(templateWidth(room.template) / 2),
    y: room.origin.y + Math.floor(room.template.tiles.length / 2),
  };
}

function templateWidth(template: RoomTemplate): number {
  return template.tiles[0]?.length ?? 0;
}

const OUTWARD: Record<Doorway["side"], Vector2> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

/**
 * Picks the doorway facing `towards`. Rooms are chained, so a corridor should leave by the side the
 * next room is actually on rather than by whichever doorway happens to be listed first.
 *
 * Doorways whose outward tile is unusable are skipped, which is what `side` is for. A west doorway
 * on a room sitting against the world's edge opens onto nothing, and choosing it strands the
 * corridor before it starts - the corridor then falls back to cutting through rooms, which quietly
 * un-gates the locked door at the exit.
 */
function doorwayTowards(room: PlacedRoom, towards: Vector2, grid: TileGrid, rooms: readonly PlacedRoom[]): Vector2 {
  const candidates = room.template.doorways.map((doorway) => {
    const position = { x: room.origin.x + doorway.x, y: room.origin.y + doorway.y };
    const outward = {
      x: position.x + OUTWARD[doorway.side].x,
      y: position.y + OUTWARD[doorway.side].y,
    };
    return { position, outward };
  });

  const usable = candidates.filter(
    ({ outward }) =>
      outward.x > 0 &&
      outward.y > 0 &&
      outward.x < grid.width - 1 &&
      outward.y < grid.height - 1 &&
      !rooms.some(
        (other) =>
          outward.x >= other.state.x &&
          outward.x < other.state.x + other.state.width &&
          outward.y >= other.state.y &&
          outward.y < other.state.y + other.state.height,
      ),
  );

  const options = usable.length > 0 ? usable : candidates;
  let best = options[0]!.position;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const { position } of options) {
    const gap = Math.hypot(position.x - towards.x, position.y - towards.y);
    if (gap < bestDistance) {
      best = position;
      bestDistance = gap;
    }
  }

  return best;
}

/** The tiles an L from `from` to `to` would cover, turning once. */
function corridorPath(from: Vector2, to: Vector2, horizontalFirst: boolean): Vector2[] {
  const corner = horizontalFirst ? { x: to.x, y: from.y } : { x: from.x, y: to.y };
  const path: Vector2[] = [];

  for (let x = Math.min(from.x, corner.x); x <= Math.max(from.x, corner.x); x += 1) {
    path.push({ x, y: from.y });
  }
  for (let y = Math.min(from.y, corner.y); y <= Math.max(from.y, corner.y); y += 1) {
    path.push({ x: corner.x, y });
  }
  for (let x = Math.min(corner.x, to.x); x <= Math.max(corner.x, to.x); x += 1) {
    path.push({ x, y: to.y });
  }
  for (let y = Math.min(corner.y, to.y); y <= Math.max(corner.y, to.y); y += 1) {
    path.push({ x: to.x, y });
  }

  return path;
}

/**
 * Whether a path only enters rooms at the two doorways it joins.
 *
 * A corridor that cuts through a room's wall anywhere else quietly breaks the level: rooms leak
 * into each other, and a locked door stops gating anything because there is a second way in. The
 * generator tries both L orientations and takes one that stays out of the rooms.
 */
function avoidsRooms(
  path: readonly Vector2[],
  rooms: readonly PlacedRoom[],
  endpoints: readonly Vector2[],
): boolean {
  const allowed = new Set(endpoints.map((point) => `${point.x},${point.y}`));

  return !path.some((tile) => {
    if (allowed.has(`${tile.x},${tile.y}`)) return false;

    return rooms.some(
      (room) =>
        tile.x >= room.state.x &&
        tile.x < room.state.x + room.state.width &&
        tile.y >= room.state.y &&
        tile.y < room.state.y + room.state.height,
    );
  });
}

/** Cuts a path into the grid. Returns the tiles it actually opened, for corridor lighting. */
function carvePath(grid: TileGrid, path: readonly Vector2[]): Vector2[] {
  const carved: Vector2[] = [];

  for (const { x, y } of path) {
    if (!grid.inBounds(x, y)) continue;
    // The outer ring stays solid, or a corridor could open onto the edge of the world.
    if (x === 0 || y === 0 || x === grid.width - 1 || y === grid.height - 1) continue;

    if (grid.get(x, y) !== FLOOR) carved.push({ x, y });
    grid.set(x, y, FLOOR);
  }

  return carved;
}

/**
 * Shortest route from `from` to `to` that only touches rooms at those two tiles.
 *
 * A breadth-first search over the gaps between rooms rather than a straight L, because an L that
 * happens to cross a room has to either breach its wall or be abandoned. Neither is acceptable: a
 * breach silently un-gates the locked door that makes the key worth finding, and abandoning the
 * corridor disconnects the run. The padding between rooms is what this walks through.
 *
 * Null when no such route exists, which the caller handles rather than producing a broken map.
 */
function routeAroundRooms(
  grid: TileGrid,
  from: Vector2,
  to: Vector2,
  rooms: readonly PlacedRoom[],
): Vector2[] | null {
  const key = (tile: Vector2): string => `${tile.x},${tile.y}`;
  const goal = key(to);
  const endpoints = new Set([key(from), goal]);

  const passable = (tile: Vector2): boolean => {
    // The outer ring stays solid, or a corridor could open onto the edge of the world.
    if (tile.x <= 0 || tile.y <= 0 || tile.x >= grid.width - 1 || tile.y >= grid.height - 1) {
      return false;
    }
    if (endpoints.has(key(tile))) return true;

    return !rooms.some(
      (room) =>
        tile.x >= room.state.x &&
        tile.x < room.state.x + room.state.width &&
        tile.y >= room.state.y &&
        tile.y < room.state.y + room.state.height,
    );
  };

  const cameFrom = new Map<string, Vector2 | null>([[key(from), null]]);
  const queue: Vector2[] = [from];

  while (queue.length > 0) {
    const tile = queue.shift()!;
    if (key(tile) === goal) {
      const path: Vector2[] = [];
      for (let step: Vector2 | null = tile; step; step = cameFrom.get(key(step)) ?? null) {
        path.push(step);
      }
      return path.reverse();
    }

    for (const next of [
      { x: tile.x + 1, y: tile.y },
      { x: tile.x - 1, y: tile.y },
      { x: tile.x, y: tile.y + 1 },
      { x: tile.x, y: tile.y - 1 },
    ]) {
      if (cameFrom.has(key(next)) || !passable(next)) continue;

      cameFrom.set(key(next), tile);
      queue.push(next);
    }
  }

  return null;
}

/**
 * Joins two doorways. Routes around the rooms when it can, and falls back to a straight L only when
 * no such route exists at all, because a dungeon whose rooms are tidy but whose exit is unreachable
 * is worse than one with an extra opening.
 */
function carveCorridor(
  grid: TileGrid,
  from: Vector2,
  to: Vector2,
  rooms: readonly PlacedRoom[],
  horizontalFirst: boolean,
): Vector2[] {
  const routed = routeAroundRooms(grid, from, to, rooms);
  if (routed) return carvePath(grid, routed);

  const preferred = corridorPath(from, to, horizontalFirst);
  const alternate = corridorPath(from, to, !horizontalFirst);
  const clean = [preferred, alternate].find((path) => avoidsRooms(path, rooms, [from, to]));
  return carvePath(grid, clean ?? preferred);
}

/** Floor tiles inside a placed room, in world coordinates. Where anything scattered can land. */
function floorTilesOf(room: PlacedRoom): Vector2[] {
  const tiles: Vector2[] = [];
  room.template.tiles.forEach((row, y) => {
    [...row].forEach((tile, x) => {
      if (tile === FLOOR) tiles.push({ x: room.origin.x + x, y: room.origin.y + y });
    });
  });
  return tiles;
}

/** Templates of a kind the slot allows. Content validation guarantees this is never empty. */
function templatesForKinds(content: GameContent, kinds: readonly RoomKind[]): RoomTemplate[] {
  const allowed = new Set<RoomKind>(kinds);
  return [...content.templates.values()].filter((template) => allowed.has(template.kind));
}

/**
 * Chooses the run's rooms: an entrance, each slot's roll in order, then an exit. The order is the
 * order a party walks them, which is what makes the corridor chain meaningful.
 */
function chooseTemplates(
  definition: GeneratedDungeon,
  content: GameContent,
  rng: Rng,
): RoomTemplate[] {
  const chosen: RoomTemplate[] = [rng.pick(templatesForKinds(content, ["entrance"]))];

  for (const slot of definition.slots) {
    const options = templatesForKinds(content, slot.kinds);
    const count = rng.int(slot.min, slot.max);
    for (let index = 0; index < count; index += 1) chosen.push(rng.pick(options));
  }

  chosen.push(rng.pick(templatesForKinds(content, ["exit"])));
  return chosen;
}

/**
 * Lays rooms out row by row, wrapping when the next one would overflow the world's width. Simple on
 * purpose: the chain of corridors is what guarantees the dungeon is connected, so placement only has
 * to avoid overlap and stay in bounds.
 */
function placeRooms(templates: readonly RoomTemplate[], definition: GeneratedDungeon, rng: Rng): PlacedRoom[] {
  const placed: PlacedRoom[] = [];
  let cursorX = WORLD_MARGIN;
  let cursorY = WORLD_MARGIN;
  let rowHeight = 0;

  for (const template of templates) {
    const width = templateWidth(template);
    const height = template.tiles.length;

    if (cursorX + width + WORLD_MARGIN > definition.width) {
      cursorX = WORLD_MARGIN;
      cursorY += rowHeight + ROOM_PADDING;
      rowHeight = 0;
    }

    if (cursorY + height + WORLD_MARGIN > definition.height) {
      throw new Error(
        `Dungeon "${definition.id}" does not fit in ${definition.width}x${definition.height}: ` +
          `room "${template.id}" overflows. Raise width/height or lower the slot counts.`,
      );
    }

    placed.push({
      template,
      origin: { x: cursorX, y: cursorY },
      state: {
        id: rng.uuid(),
        name: template.name,
        kind: template.kind,
        x: cursorX,
        y: cursorY,
        width,
        height,
      },
    });

    cursorX += width + ROOM_PADDING;
    rowHeight = Math.max(rowHeight, height);
  }

  return placed;
}

function stampRooms(grid: TileGrid, rooms: readonly PlacedRoom[]): void {
  for (const room of rooms) {
    room.template.tiles.forEach((row, y) => {
      [...row].forEach((tile, x) => grid.set(room.origin.x + x, room.origin.y + y, tile));
    });
  }
}

/**
 * Scatters a template's monsters and loot across its floor, one entity per tile.
 *
 * Tiles are shuffled from the seeded stream and taken in order, so placement is replayable. A rule
 * asking for more than there is room for simply places what fits rather than failing: content should
 * not be able to make a dungeon unbuildable by being generous.
 */
function populate(
  room: PlacedRoom,
  content: GameContent,
  rng: Rng,
  reserved: Set<string>,
): { monsters: MonsterState[]; loot: LootState[]; traps: TrapState[] } {
  const key = (tile: Vector2): string => `${tile.x},${tile.y}`;
  const open = rng.shuffle(floorTilesOf(room).filter((tile) => !reserved.has(key(tile))));
  let cursor = 0;

  const take = (): Vector2 | null => {
    while (cursor < open.length) {
      const tile = open[cursor]!;
      cursor += 1;
      if (reserved.has(key(tile))) continue;
      reserved.add(key(tile));
      return tile;
    }
    return null;
  };

  const monsters: MonsterState[] = [];
  for (const rule of room.template.monsters) {
    const type = content.monsters.get(rule.typeId);
    if (!type) throw new Error(`Template "${room.template.id}" spawns unknown monster "${rule.typeId}"`);

    const count = rng.int(rule.min, rule.max);
    for (let index = 0; index < count; index += 1) {
      const tile = take();
      if (!tile) break;
      monsters.push(monsterInstance(type, tile, rng.uuid()));
    }
  }

  const loot: LootState[] = [];
  for (const rule of room.template.loot) {
    const item = content.items.get(rule.itemId);
    if (!item) throw new Error(`Template "${room.template.id}" spawns unknown item "${rule.itemId}"`);

    // Preserve the seeded stream for ordinary loot: a default chance of 1 should not consume a
    // random draw and silently move every entity id and later placement in existing dungeons.
    if (rule.chance < 1 && rng.next() > rule.chance) continue;

    const count = rng.int(rule.min, rule.max);
    for (let index = 0; index < count; index += 1) {
      const tile = take();
      if (!tile) break;
      loot.push(lootInstance(item, tile, rng.uuid()));
    }
  }

  const traps: TrapState[] = [];
  for (const rule of room.template.traps) {
    const type = content.traps.get(rule.typeId);
    if (!type) throw new Error(`Template "${room.template.id}" spawns unknown trap "${rule.typeId}"`);

    const count = rng.int(rule.min, rule.max);
    for (let index = 0; index < count; index += 1) {
      const tile = take();
      if (!tile) break;
      traps.push(trapInstance(type, tile, rng.uuid()));
    }
  }

  return { monsters, loot, traps };
}

export function generateDungeon(
  definition: GeneratedDungeon,
  content: GameContent,
  seed: number,
): BuiltDungeon {
  const rng = createRng(seed);
  const grid = new TileGrid(definition.width, definition.height);

  const rooms = placeRooms(chooseTemplates(definition, content, rng), definition, rng);
  stampRooms(grid, rooms);

  // Reserved tiles hold everything already claimed, so two entities never share one.
  const reserved = new Set<string>();
  const monsters: MonsterState[] = [];
  const loot: LootState[] = [];
  const traps: TrapState[] = [];
  const puzzles: PuzzleState[] = [];
  const lightSources: LightSourceState[] = [];
  const corridorTiles: Vector2[] = [];

  for (const room of rooms) {
    for (const light of room.template.lights) {
      const position = { x: room.origin.x + light.x, y: room.origin.y + light.y };
      reserved.add(`${position.x},${position.y}`);
      lightSources.push({
        id: rng.uuid(),
        name: light.name,
        kind: "fixed",
        position,
        radius: light.radius,
      });
    }
  }

  // Plates are fixed by the template, so they are claimed before anything is scattered around them.
  for (const room of rooms) {
    for (const rule of room.template.puzzles) {
      const type = content.puzzles.get(rule.typeId);
      if (!type) throw new Error(`Template "${room.template.id}" spawns unknown puzzle "${rule.typeId}"`);

      const plates = rule.plates.map((plate) => ({ x: room.origin.x + plate.x, y: room.origin.y + plate.y }));
      for (const plate of plates) reserved.add(`${plate.x},${plate.y}`);
      puzzles.push(puzzleInstance(type, plates, rng.uuid()));
    }
  }

  // Chain the rooms. Each corridor joins the doorways the two rooms face each other with, so the
  // whole run is connected from entrance to exit by construction.
  for (let index = 0; index < rooms.length - 1; index += 1) {
    const from = rooms[index]!;
    const to = rooms[index + 1]!;
    const start = doorwayTowards(from, centerOf(to), grid, rooms);
    const end = doorwayTowards(to, centerOf(from), grid, rooms);
    corridorTiles.push(...carveCorridor(grid, start, end, rooms, rng.next() < 0.5));
  }

  for (const room of rooms) {
    const populated = populate(room, content, rng, reserved);
    monsters.push(...populated.monsters);
    loot.push(...populated.loot);
    traps.push(...populated.traps);
  }

  const light = definition.corridorLight;
  if (light) {
    corridorTiles.forEach((tile, index) => {
      if (index % light.everyTiles !== 0) return;
      lightSources.push({
        id: rng.uuid(),
        name: light.name,
        kind: "fixed",
        position: { ...tile },
        radius: light.radius,
      });
    });
  }

  const entrance = rooms[0]!;
  const exitRoom = rooms[rooms.length - 1]!;

  // The exit sits on the far side of its room from the way in, so a party still has to cross it.
  const exitTile =
    rng.shuffle(floorTilesOf(exitRoom).filter((tile) => !reserved.has(`${tile.x},${tile.y}`)))[0] ??
    centerOf(exitRoom);
  reserved.add(`${exitTile.x},${exitTile.y}`);

  const exits: ExitState[] = [
    { id: rng.uuid(), position: { ...exitTile }, destination: definition.exitDestination },
  ];

  // A locked door on the way into the exit room, so the keys the puzzle and boss rooms drop are
  // what ends a run. Without it the exit is just another room to walk into.
  const exitDoorTile = doorwayTowards(exitRoom, centerOf(rooms[rooms.length - 2] ?? entrance), grid, rooms);
  const doors: DoorState[] = [
    { id: rng.uuid(), position: { ...exitDoorTile }, size: 1, open: false, locked: true },
  ];

  const spawnPoints = rng
    .shuffle(floorTilesOf(entrance).filter((tile) => !reserved.has(`${tile.x},${tile.y}`)))
    .slice(0, 4);

  return {
    dungeon: {
      map: {
        id: definition.id,
        name: definition.name,
        width: definition.width,
        height: definition.height,
        originX: 0,
        originY: 0,
        tiles: grid.toTiles(),
      },
      rooms: rooms.map((room) => room.state),
      monsters,
      loot,
      traps,
      puzzles,
      doors,
      exits,
      lightSources,
    },
    spawnPoints: spawnPoints.length > 0 ? spawnPoints : [centerOf(entrance)],
    seed,
  };
}
