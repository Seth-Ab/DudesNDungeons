import type { Doorway } from "../../content/schema.js";
import type { Rng } from "../random.js";

/**
 * Room shapes for the grid generator (decision 0016, stage 4).
 *
 * A room is a rectangle of `#` and `.` whose four sockets sit at the midpoint of each side, so the
 * grid layout can join rooms socket to socket without knowing what is inside. A shape draws walls
 * into a bordered, all-floor room; `repairSockets` then guarantees the four sockets reach one
 * another through the room's own floor and fills any floor nobody can reach. Everything here is a
 * pure function of its inputs and the seeded stream, so a run replays exactly.
 */

export type RoomSide = Doorway["side"];

export interface Point {
  x: number;
  y: number;
}

/** A socket: the wall tile a corridor attaches to, and the floor tile just inside it. */
export interface Socket {
  side: RoomSide;
  wall: Point;
  inward: Point;
}

type Grid = string[][];

const WALL = "#";
const FLOOR = ".";

const SIDES: readonly RoomSide[] = ["north", "south", "west", "east"];

const DIRECTIONS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

export const ROOM_SHAPE_IDS = [
  "plain",
  "pillars",
  "block",
  "cross",
  "ring",
  "octagon",
  "partition",
  "alcoves",
  "maze",
  "cavern",
] as const;
export type RoomShapeId = (typeof ROOM_SHAPE_IDS)[number];

/** A cavern keeps at least this fraction of its interior as floor, or it is rolled again. */
export const MIN_CAVERN_FLOOR_FRACTION = 0.45;
/** How many caverns are rolled before the room falls back to plain. */
export const CAVERN_ATTEMPTS = 6;

function assertRoomSize(width: number, height: number): void {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 3 || height < 3) {
    throw new Error(`A room needs a whole width and height of at least 3, got ${width}x${height}`);
  }
  // Even sizes have no single middle tile, so rotating would push a socket off its midpoint.
  if (width % 2 === 0 || height % 2 === 0) {
    throw new Error(`Room sizes must be odd so sockets stay on side midpoints, got ${width}x${height}`);
  }
}

/** The four sockets of a `width` by `height` room, at the middle of each side. */
export function midpointSockets(width: number, height: number): Record<RoomSide, Socket> {
  const cx = Math.floor(width / 2);
  const cy = Math.floor(height / 2);
  return {
    north: { side: "north", wall: { x: cx, y: 0 }, inward: { x: cx, y: 1 } },
    south: { side: "south", wall: { x: cx, y: height - 1 }, inward: { x: cx, y: height - 2 } },
    west: { side: "west", wall: { x: 0, y: cy }, inward: { x: 1, y: cy } },
    east: { side: "east", wall: { x: width - 1, y: cy }, inward: { x: width - 2, y: cy } },
  };
}

/** The doorways a `sockets: "midpoints"` template stands for, so existing consumers need no change. */
export function midpointDoorways(width: number, height: number): Doorway[] {
  const sockets = midpointSockets(width, height);
  return SIDES.map((side) => ({ ...sockets[side].wall, side }));
}

function blankRoom(width: number, height: number): Grid {
  return Array.from({ length: height }, (_, y) =>
    Array.from({ length: width }, (_, x) => (x === 0 || y === 0 || x === width - 1 || y === height - 1 ? WALL : FLOOR)),
  );
}

function toGrid(tiles: readonly string[]): Grid {
  return tiles.map((row) => [...row]);
}

function toTiles(grid: Grid): string[] {
  return grid.map((row) => row.join(""));
}

const key = (x: number, y: number): string => `${x},${y}`;

function interior(grid: Grid, visit: (x: number, y: number) => void): void {
  for (let y = 1; y < grid.length - 1; y += 1) {
    for (let x = 1; x < grid[0]!.length - 1; x += 1) visit(x, y);
  }
}

const SHAPES: Record<RoomShapeId, (grid: Grid, rng: Rng) => void> = {
  plain: () => {},

  pillars(grid) {
    interior(grid, (x, y) => {
      if (x % 4 === 3 && y % 4 === 3 && x < grid[0]!.length - 2 && y < grid.length - 2) grid[y]![x] = WALL;
    });
  },

  block(grid) {
    const width = grid[0]!.length;
    const height = grid.length;
    const blockWidth = Math.max(1, Math.floor(width / 3));
    const blockHeight = Math.max(1, Math.floor(height / 3));
    const left = Math.floor((width - blockWidth) / 2);
    const top = Math.floor((height - blockHeight) / 2);
    for (let y = top; y < top + blockHeight; y += 1) {
      for (let x = left; x < left + blockWidth; x += 1) grid[y]![x] = WALL;
    }
  },

  cross(grid) {
    const width = grid[0]!.length;
    const height = grid.length;
    const cornerWidth = Math.floor((width - 3) / 2) - 1;
    const cornerHeight = Math.floor((height - 3) / 2) - 1;
    interior(grid, (x, y) => {
      const horizontal = x <= cornerWidth || x >= width - 1 - cornerWidth;
      const vertical = y <= cornerHeight || y >= height - 1 - cornerHeight;
      if (horizontal && vertical) grid[y]![x] = WALL;
    });
  },

  ring(grid) {
    const width = grid[0]!.length;
    const height = grid.length;
    for (let y = 3; y < height - 3; y += 1) {
      for (let x = 3; x < width - 3; x += 1) grid[y]![x] = WALL;
    }
  },

  octagon(grid) {
    const width = grid[0]!.length;
    const height = grid.length;
    const cut = Math.max(1, Math.floor(Math.min(width, height) / 4));
    interior(grid, (x, y) => {
      const dx = Math.min(x, width - 1 - x);
      const dy = Math.min(y, height - 1 - y);
      if (dx + dy <= cut) grid[y]![x] = WALL;
    });
  },

  partition(grid, rng) {
    const width = grid[0]!.length;
    const height = grid.length;
    const column = Math.floor(width / 2);
    const gap = rng.int(1, height - 2);
    for (let y = 1; y < height - 1; y += 1) {
      if (y === gap || y === Math.floor(height / 2)) continue;
      grid[y]![column] = WALL;
    }
  },

  alcoves(grid) {
    const width = grid[0]!.length;
    const height = grid.length;
    const horizontal = width >= height;
    interior(grid, (x, y) => {
      if (horizontal && (y === 2 || y === height - 3) && x % 2 === 0 && x > 1 && x < width - 2) grid[y]![x] = WALL;
      if (!horizontal && (x === 2 || x === width - 3) && y % 2 === 0 && y > 1 && y < height - 2) grid[y]![x] = WALL;
    });
  },

  maze(grid, rng) {
    const width = grid[0]!.length;
    const height = grid.length;
    interior(grid, (x, y) => {
      grid[y]![x] = WALL;
    });

    // Depth-first carve over the odd-coordinate cells, two tiles at a time.
    const stack: Point[] = [{ x: 1, y: 1 }];
    grid[1]![1] = FLOOR;
    while (stack.length > 0) {
      const here = stack[stack.length - 1]!;
      const options = rng.shuffle(DIRECTIONS).filter((direction) => {
        const x = here.x + direction.x * 2;
        const y = here.y + direction.y * 2;
        return x > 0 && y > 0 && x < width - 1 && y < height - 1 && grid[y]![x] === WALL;
      });
      const direction = options[0];
      if (!direction) {
        stack.pop();
        continue;
      }
      grid[here.y + direction.y]![here.x + direction.x] = FLOOR;
      grid[here.y + direction.y * 2]![here.x + direction.x * 2] = FLOOR;
      stack.push({ x: here.x + direction.x * 2, y: here.y + direction.y * 2 });
    }

    // Braid: knock through a few walls between two floors, so the maze has loops.
    interior(grid, (x, y) => {
      if (grid[y]![x] !== WALL) return;
      const horizontal = grid[y]![x - 1] === FLOOR && grid[y]![x + 1] === FLOOR;
      const vertical = grid[y - 1]?.[x] === FLOOR && grid[y + 1]?.[x] === FLOOR;
      if ((horizontal || vertical) && rng.chance(0.12)) grid[y]![x] = FLOOR;
    });
  },

  cavern(grid, rng) {
    const width = grid[0]!.length;
    const height = grid.length;
    interior(grid, (x, y) => {
      grid[y]![x] = rng.chance(0.42) ? WALL : FLOOR;
    });
    // Cellular automaton: a tile with five or more walls in its 3x3 neighbourhood becomes wall.
    for (let pass = 0; pass < 4; pass += 1) {
      const before = grid.map((row) => [...row]);
      interior(grid, (x, y) => {
        let walls = 0;
        for (let dy = -1; dy <= 1; dy += 1) {
          for (let dx = -1; dx <= 1; dx += 1) if (before[y + dy]![x + dx] === WALL) walls += 1;
        }
        grid[y]![x] = walls >= 5 ? WALL : FLOOR;
      });
    }
    grid[Math.floor(height / 2)]![Math.floor(width / 2)] = FLOOR;
  },
};

/** Floor tiles reachable from `start` through 4-connected floor. */
function floodFloor(grid: Grid, start: Point): Set<string> {
  const seen = new Set<string>([key(start.x, start.y)]);
  const queue: Point[] = [start];
  for (let head = 0; head < queue.length; head += 1) {
    const { x, y } = queue[head]!;
    for (const direction of DIRECTIONS) {
      const next = { x: x + direction.x, y: y + direction.y };
      if (grid[next.y]?.[next.x] !== FLOOR || seen.has(key(next.x, next.y))) continue;
      seen.add(key(next.x, next.y));
      queue.push(next);
    }
  }
  return seen;
}

/**
 * Carves the cheapest path from `from` to any tile in `reached`: stepping onto floor costs nothing
 * and onto wall costs one, so a 0-1 BFS (cost-0 steps to the front of the deque, cost-1 steps to the
 * back) finds the route that breaks the fewest walls. It never leaves the interior, so the room's
 * border stays solid.
 */
function carveToReached(grid: Grid, from: Point, reached: ReadonlySet<string>): void {
  const width = grid[0]!.length;
  const height = grid.length;
  const cost = new Map<string, number>([[key(from.x, from.y), 0]]);
  const previous = new Map<string, Point>();
  const deque: Point[] = [from];
  let goal: Point | undefined;

  while (deque.length > 0) {
    const here = deque.shift()!;
    if (reached.has(key(here.x, here.y))) {
      goal = here;
      break;
    }
    for (const direction of DIRECTIONS) {
      const next = { x: here.x + direction.x, y: here.y + direction.y };
      if (next.x < 1 || next.y < 1 || next.x > width - 2 || next.y > height - 2) continue;
      const step = grid[next.y]![next.x] === WALL ? 1 : 0;
      const total = cost.get(key(here.x, here.y))! + step;
      const known = cost.get(key(next.x, next.y));
      if (known !== undefined && known <= total) continue;
      cost.set(key(next.x, next.y), total);
      previous.set(key(next.x, next.y), here);
      if (step === 0) deque.unshift(next);
      else deque.push(next);
    }
  }

  // The interior is connected once its walls are counted as passable, so a goal always exists.
  for (let point = goal; point; point = previous.get(key(point.x, point.y))) {
    grid[point.y]![point.x] = FLOOR;
  }
}

/**
 * Connects all four sockets through the room's own floor, carving as few walls as it can, then fills
 * floor pockets nothing reaches. Returns the repaired tiles. The room's border is never touched, so
 * the socket wall tiles stay walls until a corridor is cut through them.
 */
export function repairSockets(tiles: readonly string[]): string[] {
  const grid = toGrid(tiles);
  assertRoomSize(grid[0]?.length ?? 0, grid.length);
  const sockets = Object.values(midpointSockets(grid[0]!.length, grid.length));

  for (const socket of sockets) grid[socket.inward.y]![socket.inward.x] = FLOOR;

  const root = sockets[0]!.inward;
  for (const socket of sockets.slice(1)) {
    const reached = floodFloor(grid, root);
    if (reached.has(key(socket.inward.x, socket.inward.y))) continue;
    carveToReached(grid, socket.inward, reached);
  }

  const reached = floodFloor(grid, root);
  interior(grid, (x, y) => {
    if (grid[y]![x] === FLOOR && !reached.has(key(x, y))) grid[y]![x] = WALL;
  });
  return toTiles(grid);
}

function countFloor(tiles: readonly string[]): number {
  let floor = 0;
  for (const row of tiles) for (const tile of row) if (tile === FLOOR) floor += 1;
  return floor;
}

export interface GeneratedRoomShape {
  tiles: string[];
  /** The shape actually drawn, which is `plain` when a cavern fell back. */
  shape: RoomShapeId;
}

export interface RoomShapeOptions {
  /** Overrides `MIN_CAVERN_FLOOR_FRACTION`; a test uses it to force the fallback. */
  minCavernFloorFraction?: number;
}

/**
 * A procedural room of `shape`. A cavern that keeps too little floor is rolled again, up to
 * `CAVERN_ATTEMPTS` times, and then the room falls back to plain so generation always gets a room.
 */
export function generateRoomShape(
  shape: RoomShapeId,
  width: number,
  height: number,
  rng: Rng,
  options: RoomShapeOptions = {},
): GeneratedRoomShape {
  assertRoomSize(width, height);
  const minFraction = options.minCavernFloorFraction ?? MIN_CAVERN_FLOOR_FRACTION;
  const interiorArea = (width - 2) * (height - 2);
  const attempts = shape === "cavern" ? CAVERN_ATTEMPTS : 1;

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const grid = blankRoom(width, height);
    SHAPES[shape](grid, rng);
    const tiles = repairSockets(toTiles(grid));
    if (shape !== "cavern" || countFloor(tiles) >= interiorArea * minFraction) return { tiles, shape };
  }

  return { tiles: repairSockets(toTiles(blankRoom(width, height))), shape: "plain" };
}

/** A rotation by quarter turns clockwise, then an optional left-right mirror. */
export interface RoomTransform {
  turns: 0 | 1 | 2 | 3;
  mirror: boolean;
}

export function rollTransform(rng: Rng): RoomTransform {
  return { turns: rng.int(0, 3) as RoomTransform["turns"], mirror: rng.chance(0.5) };
}

/** Where a tile of a `width` by `height` room lands after `transform`, and the new room size. */
export function transformPoint(
  point: Point,
  width: number,
  height: number,
  transform: RoomTransform,
): Point & { width: number; height: number } {
  let { x, y } = point;
  let w = width;
  let h = height;
  for (let turn = 0; turn < transform.turns; turn += 1) {
    [x, y] = [h - 1 - y, x];
    [w, h] = [h, w];
  }
  if (transform.mirror) x = w - 1 - x;
  return { x, y, width: w, height: h };
}

/**
 * Rotates and mirrors a hand-authored template. Sizes must be odd, so a socket on a side midpoint
 * is still on one afterwards. A transform keeps every floor tile connected, so nothing is repaired.
 */
export function transformTiles(tiles: readonly string[], transform: RoomTransform): string[] {
  assertRoomSize(tiles[0]?.length ?? 0, tiles.length);
  const width = tiles[0]!.length;
  const height = tiles.length;
  const size = transformPoint({ x: 0, y: 0 }, width, height, transform);
  const out: Grid = Array.from({ length: size.height }, () => Array<string>(size.width).fill(WALL));
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const to = transformPoint({ x, y }, width, height, transform);
      out[to.y]![to.x] = tiles[y]![x]!;
    }
  }
  return toTiles(out);
}
