/**
 * Stage 5 of the dungeon generator (decision 0016): carve.
 *
 * Each room is stamped into its layout cell with random jitter inside the cell margin, then every
 * graph edge is joined socket to socket by a corridor that jogs once inside the gap between the two
 * rooms. Rooms sit at least `margin` tiles inside their cell, so neighbours keep at least
 * `2 * margin` tiles between them, and a corridor never leaves its gap, so it cannot cross a room.
 * The world's outer ring is never written. Everything here is a pure function of its inputs and the
 * seeded stream, so a run replays exactly. The older breadth-first router in `dungeonGenerator.ts`
 * is untouched and stays the layout for a profile that opts out of the grid.
 */
import type { Rng } from "../random.js";
import type { LayoutGraph } from "./layout.js";
import { midpointSockets, type Point, type RoomSide } from "./roomShapes.js";

const WALL = "#";
const FLOOR = ".";

export interface CarveGrid {
  /** Side of one layout cell, in authored tiles. */
  readonly cell: number;
  /** Tiles kept clear inside each cell on every side; rooms jitter within what is left. */
  readonly margin: number;
}

export interface CarvedRoom {
  /** The layout node this room belongs to. */
  readonly nodeId: number;
  /** World position of the room's top-left tile. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface CarvedCorridor {
  /** Index into `LayoutGraph.edges`. */
  readonly edge: number;
  /** The two socket wall tiles it opens, in world coordinates, `from` on the edge's `a` room. */
  readonly from: Point;
  readonly to: Point;
  /** Every tile it opens, socket tiles included, in walking order from `from` to `to`. Lights read this. */
  readonly tiles: readonly Point[];
}

export interface CarvedWorld {
  /** Authored tiles of `#` and `.`, `cols * cell` wide and `rows * cell` tall. */
  readonly tiles: readonly string[];
  /** One entry per layout node, indexed by node id. */
  readonly rooms: readonly CarvedRoom[];
  /** One entry per layout edge, indexed by edge. */
  readonly corridors: readonly CarvedCorridor[];
}

interface Direction {
  readonly dc: number;
  readonly dr: number;
  readonly side: RoomSide;
  readonly opposite: RoomSide;
}

const DIRECTIONS: readonly Direction[] = [
  { dc: 1, dr: 0, side: "east", opposite: "west" },
  { dc: -1, dr: 0, side: "west", opposite: "east" },
  { dc: 0, dr: 1, side: "south", opposite: "north" },
  { dc: 0, dr: -1, side: "north", opposite: "south" },
];

const NEIGHBORS: readonly Point[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

const key = (point: Point): string => `${point.x},${point.y}`;

/** The tiles of an axis-aligned run from `from` to `to`, both included. */
function run(from: Point, to: Point): Point[] {
  const tiles: Point[] = [];
  const dx = Math.sign(to.x - from.x);
  const dy = Math.sign(to.y - from.y);
  for (let at = { ...from }; ; at = { x: at.x + dx, y: at.y + dy }) {
    tiles.push(at);
    if (at.x === to.x && at.y === to.y) return tiles;
  }
}

/** The corridor from `from` to `to` that runs to column (or row) `jog`, crosses over, and runs on. */
function jogged(from: Point, to: Point, horizontal: boolean, jog: number): Point[] {
  const corner1: Point = horizontal ? { x: jog, y: from.y } : { x: from.x, y: jog };
  const corner2: Point = horizontal ? { x: jog, y: to.y } : { x: to.x, y: jog };
  const path = [...run(from, corner1), ...run(corner1, corner2).slice(1), ...run(corner2, to).slice(1)];
  // A straight corridor repeats nothing, but a zero-length leg would repeat a corner; drop repeats.
  return path.filter((tile, index) => index === 0 || key(tile) !== key(path[index - 1]!));
}

/**
 * Stamps `roomTiles` (one `#`/`.` room per layout node, indexed by node id, each with sockets at its
 * side midpoints) into the layout's cells and joins every edge. Returns null when no corridor can
 * keep clear of the corridors already cut, so the caller retries with another stream rather than
 * ship two corridors that merge into a connection the graph does not have. Throws when a room is too
 * large for its cell, because no stream could fix that.
 */
export function carveDungeon(
  rng: Rng,
  graph: LayoutGraph,
  roomTiles: readonly (readonly string[])[],
  grid: CarveGrid,
): CarvedWorld | null {
  if (roomTiles.length !== graph.nodes.length) {
    throw new Error(`Carve needs one room per layout node, got ${roomTiles.length} for ${graph.nodes.length}`);
  }
  const width = graph.cols * grid.cell;
  const height = graph.rows * grid.cell;
  const world: string[][] = Array.from({ length: height }, () => Array<string>(width).fill(WALL));
  // The outer ring is never written, so it stays solid whatever a room or corridor asks for.
  const open = (point: Point, tile: string): void => {
    if (point.x <= 0 || point.y <= 0 || point.x >= width - 1 || point.y >= height - 1) return;
    world[point.y]![point.x] = tile;
  };

  const inRoom = new Set<string>();
  const rooms: CarvedRoom[] = graph.nodes.map((node) => {
    const tiles = roomTiles[node.id]!;
    const roomWidth = tiles[0]!.length;
    const roomHeight = tiles.length;
    const slack = grid.cell - 2 * grid.margin;
    if (roomWidth > slack || roomHeight > slack) {
      throw new Error(
        `A ${roomWidth}x${roomHeight} room does not fit a ${grid.cell}-tile cell with a margin of ${grid.margin}`,
      );
    }
    const room: CarvedRoom = {
      nodeId: node.id,
      x: node.cell.c * grid.cell + rng.int(grid.margin, grid.cell - grid.margin - roomWidth),
      y: node.cell.r * grid.cell + rng.int(grid.margin, grid.cell - grid.margin - roomHeight),
      width: roomWidth,
      height: roomHeight,
    };
    tiles.forEach((row, ly) => {
      [...row].forEach((tile, lx) => {
        open({ x: room.x + lx, y: room.y + ly }, tile);
        inRoom.add(key({ x: room.x + lx, y: room.y + ly }));
      });
    });
    return room;
  });

  const cut = new Set<string>();
  const corridors: CarvedCorridor[] = [];
  for (const [index, edge] of graph.edges.entries()) {
    const a = graph.nodes[edge.a]!;
    const b = graph.nodes[edge.b]!;
    const direction = DIRECTIONS.find((d) => d.dc === b.cell.c - a.cell.c && d.dr === b.cell.r - a.cell.r);
    if (!direction) throw new Error(`Edge ${edge.a}-${edge.b} joins cells that are not neighbours`);
    const roomA = rooms[edge.a]!;
    const roomB = rooms[edge.b]!;
    const socketA = midpointSockets(roomA.width, roomA.height)[direction.side].wall;
    const socketB = midpointSockets(roomB.width, roomB.height)[direction.opposite].wall;
    const from = { x: roomA.x + socketA.x, y: roomA.y + socketA.y };
    const to = { x: roomB.x + socketB.x, y: roomB.y + socketB.y };

    // The jog lies strictly between the two sockets along the corridor's main axis, which is
    // inside the gap between the rooms.
    const horizontal = direction.dc !== 0;
    const lo = horizontal ? Math.min(from.x, to.x) : Math.min(from.y, to.y);
    const hi = horizontal ? Math.max(from.x, to.x) : Math.max(from.y, to.y);
    const jogs: number[] = [];
    for (let jog = lo + 1; jog <= hi - 1; jog += 1) jogs.push(jog);

    const endpoints = new Set([key(from), key(to)]);
    const clear = (tiles: readonly Point[]): boolean =>
      tiles.every(
        (tile) =>
          (endpoints.has(key(tile)) || !inRoom.has(key(tile))) &&
          !cut.has(key(tile)) &&
          NEIGHBORS.every((n) => !cut.has(key({ x: tile.x + n.x, y: tile.y + n.y }))),
      );
    const tiles = rng
      .shuffle(jogs)
      .map((jog) => jogged(from, to, horizontal, jog))
      .find(clear);
    if (!tiles) return null;

    for (const tile of tiles) {
      open(tile, FLOOR);
      cut.add(key(tile));
    }
    corridors.push({ edge: index, from, to, tiles });
  }

  return { tiles: world.map((row) => row.join("")), rooms, corridors };
}
