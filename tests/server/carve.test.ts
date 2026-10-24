import { describe, expect, it } from "vitest";
import { loadContent } from "../../src/server/content/loadContent.js";
import { carveDungeon, type CarvedWorld } from "../../src/server/game/generation/carve.js";
import { generateLayout, type LayoutGraph } from "../../src/server/game/generation/layout.js";
import { midpointSockets, ROOM_SHAPE_IDS, generateRoomShape } from "../../src/server/game/generation/roomShapes.js";
import { createRng, mixSeed } from "../../src/server/game/random.js";

const GRID = { cols: 6, rows: 4 };
const CELL = { cell: 16, margin: 2 };
const SEEDS = 100;
const SIZES = [5, 7, 9, 11];
const flows = [...loadContent().flows.values()];

interface Run {
  graph: LayoutGraph;
  rooms: string[][];
  world: CarvedWorld;
}

function rollRun(seed: number, flow: (typeof flows)[number]): Run | null {
  const rng = createRng(seed);
  const graph = generateLayout(rng, flow, GRID);
  if (!graph) return null;
  const rooms = graph.nodes.map(() => {
    const shape = rng.pick(ROOM_SHAPE_IDS);
    return generateRoomShape(shape, rng.pick(SIZES), rng.pick(SIZES), rng).tiles;
  });
  const world = carveDungeon(createRng(mixSeed(seed, 5)), graph, rooms, CELL);
  return world ? { graph, rooms, world } : null;
}

function sweep(): Run[] {
  const runs: Run[] = [];
  let attempts = 0;
  for (const flow of flows) {
    for (let seed = 0; seed < SEEDS; seed += 1) {
      attempts += 1;
      const run = rollRun(seed, flow);
      if (run) runs.push(run);
    }
  }
  // A null is a retry, but it must stay the exception.
  expect(runs.length).toBeGreaterThan(attempts / 4);
  return runs;
}

const runs = sweep();

describe("carveDungeon", () => {
  it("never overlaps rooms and keeps at least 4 tiles between neighbours", () => {
    for (const { world } of runs) {
      for (const a of world.rooms) {
        for (const b of world.rooms) {
          if (a.nodeId >= b.nodeId) continue;
          const gapX = Math.max(a.x - (b.x + b.width), b.x - (a.x + a.width));
          const gapY = Math.max(a.y - (b.y + b.height), b.y - (a.y + a.height));
          expect(Math.max(gapX, gapY)).toBeGreaterThanOrEqual(4);
        }
      }
    }
  });

  it("stamps each room whole inside its cell margin", () => {
    for (const { graph, rooms, world } of runs) {
      for (const room of world.rooms) {
        const node = graph.nodes[room.nodeId]!;
        expect(room.x).toBeGreaterThanOrEqual(node.cell.c * CELL.cell + CELL.margin);
        expect(room.y).toBeGreaterThanOrEqual(node.cell.r * CELL.cell + CELL.margin);
        expect(room.x + room.width).toBeLessThanOrEqual((node.cell.c + 1) * CELL.cell - CELL.margin);
        expect(room.y + room.height).toBeLessThanOrEqual((node.cell.r + 1) * CELL.cell - CELL.margin);
        const tiles = rooms[room.nodeId]!;
        for (let y = 0; y < room.height; y += 1) {
          const row = world.tiles[room.y + y]!.slice(room.x, room.x + room.width);
          // Only a socket wall may differ from the stamped room.
          for (let x = 0; x < room.width; x += 1) {
            if (row[x] !== tiles[y]![x]) expect(tiles[y]![x]).toBe("#");
          }
        }
      }
    }
  });

  it("joins exactly the two sockets of each edge and opens no other wall", () => {
    // Per-tile checks collect problems and assert once, since a sweep makes millions of them.
    const problems: string[] = [];
    for (const { graph, world } of runs) {
      expect(world.corridors).toHaveLength(graph.edges.length);
      const socketTiles = new Map<string, number[]>();
      for (const corridor of world.corridors) {
        const edge = graph.edges[corridor.edge]!;
        for (const [point, nodeId] of [[corridor.from, edge.a], [corridor.to, edge.b]] as const) {
          const room = world.rooms[nodeId]!;
          const sockets = Object.values(midpointSockets(room.width, room.height));
          expect(sockets.some((s) => room.x + s.wall.x === point.x && room.y + s.wall.y === point.y)).toBe(true);
          socketTiles.set(`${point.x},${point.y}`, [...(socketTiles.get(`${point.x},${point.y}`) ?? []), corridor.edge]);
        }
        // Walking order: starts at `from`, ends at `to`, one step at a time.
        expect(corridor.tiles[0]).toEqual(corridor.from);
        expect(corridor.tiles[corridor.tiles.length - 1]).toEqual(corridor.to);
        corridor.tiles.slice(1).forEach((tile, i) => {
          const before = corridor.tiles[i]!;
          if (Math.abs(tile.x - before.x) + Math.abs(tile.y - before.y) !== 1) problems.push(`edge ${corridor.edge} skips`);
        });
        // Only the two endpoints sit on a room; the rest is gap.
        for (const tile of corridor.tiles.slice(1, -1)) {
          for (const room of world.rooms) {
            const inside =
              tile.x >= room.x && tile.x < room.x + room.width && tile.y >= room.y && tile.y < room.y + room.height;
            if (inside) problems.push(`edge ${corridor.edge} crosses room ${room.nodeId}`);
          }
        }
      }
      // Each socket opens for one corridor at most.
      for (const edges of socketTiles.values()) expect(edges).toHaveLength(1);

      // Every open tile on a room's border is a socket of some edge.
      for (const room of world.rooms) {
        for (let y = 0; y < room.height; y += 1) {
          for (let x = 0; x < room.width; x += 1) {
            if (x !== 0 && y !== 0 && x !== room.width - 1 && y !== room.height - 1) continue;
            if (world.tiles[room.y + y]![room.x + x] === ".") {
              if (!socketTiles.has(`${room.x + x},${room.y + y}`)) problems.push(`room ${room.nodeId} opens a wall`);
            }
          }
        }
      }

      // The floor outside rooms is corridor and nothing else.
      const corridorKeys = new Set(world.corridors.flatMap((c) => c.tiles.map((t) => `${t.x},${t.y}`)));
      world.tiles.forEach((row, y) => {
        [...row].forEach((tile, x) => {
          if (tile !== ".") return;
          const room = world.rooms.some((r) => x >= r.x && x < r.x + r.width && y >= r.y && y < r.y + r.height);
          if (!room && !corridorKeys.has(`${x},${y}`)) problems.push(`stray floor at ${x},${y}`);
        });
      });
    }
    expect(problems).toEqual([]);
  });

  it("connects exactly what the graph connects, with no corridor touching another", () => {
    for (const { graph, world } of runs) {
      const owner = new Map<string, number>();
      world.corridors.forEach((c, i) => c.tiles.forEach((t) => owner.set(`${t.x},${t.y}`, i)));
      expect(owner.size).toBe(world.corridors.reduce((sum, c) => sum + c.tiles.length, 0));
      for (const [k, i] of owner) {
        const [x, y] = k.split(",").map(Number) as [number, number];
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const other = owner.get(`${x + dx},${y + dy}`);
          if (other !== undefined) expect(other).toBe(i);
        }
      }
      // Flood the floor from the entrance: it reaches every room.
      const start = world.rooms[0]!;
      const inward = midpointSockets(start.width, start.height).north.inward;
      const first = { x: start.x + inward.x, y: start.y + inward.y };
      const queue = [first];
      const visited = new Set([`${first.x},${first.y}`]);
      for (let head = 0; head < queue.length; head += 1) {
        const at = queue[head]!;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const next = { x: at.x + dx, y: at.y + dy };
          if (world.tiles[next.y]?.[next.x] !== "." || visited.has(`${next.x},${next.y}`)) continue;
          visited.add(`${next.x},${next.y}`);
          queue.push(next);
        }
      }
      for (const room of world.rooms) {
        // A room's sockets all meet inside it, so one inward tile stands for the room.
        const inward = midpointSockets(room.width, room.height).north.inward;
        expect(visited.has(`${room.x + inward.x},${room.y + inward.y}`)).toBe(true);
      }
      expect(graph.edges.length).toBe(world.corridors.length);
    }
  });

  it("keeps the outer ring of the map solid and the world the size of the grid", () => {
    for (const { world } of runs) {
      expect(world.tiles).toHaveLength(GRID.rows * CELL.cell);
      const width = GRID.cols * CELL.cell;
      expect(world.tiles.every((row) => row.length === width && /^[#.]+$/.test(row))).toBe(true);
      expect(world.tiles[0]).toBe("#".repeat(width));
      expect(world.tiles[world.tiles.length - 1]).toBe("#".repeat(width));
      expect(world.tiles.every((row) => row[0] === "#" && row[width - 1] === "#")).toBe(true);
    }
  });

  it("is a pure function of the seed", () => {
    const flow = flows[0]!;
    const a = rollRun(7, flow);
    const b = rollRun(7, flow);
    expect(a?.world).toEqual(b?.world);
  });

  it("refuses a room too large for its cell", () => {
    const graph = generateLayout(createRng(1), flows[0]!, GRID);
    if (!graph) throw new Error("expected a layout for seed 1");
    const big = graph.nodes.map(() => generateRoomShape("plain", 13, 13, createRng(1)).tiles);
    expect(() => carveDungeon(createRng(1), graph, big, CELL)).toThrow(/does not fit/);
  });
});
