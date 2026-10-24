import { describe, expect, it } from "vitest";
import {
  CAVERN_ATTEMPTS,
  ROOM_SHAPE_IDS,
  generateRoomShape,
  midpointDoorways,
  midpointSockets,
  repairSockets,
  rollTransform,
  transformPoint,
  transformTiles,
  type RoomTransform,
} from "../../src/server/game/generation/roomShapes.js";
import { createRng } from "../../src/server/game/random.js";

const SIZES: [number, number][] = [
  [3, 3],
  [5, 5],
  [7, 5],
  [9, 9],
  [11, 7],
  [11, 11],
  [15, 11],
  [21, 15],
];
const SEEDS = Array.from({ length: 40 }, (_, seed) => seed);

function floodFrom(tiles: readonly string[], x: number, y: number): Set<string> {
  const seen = new Set([`${x},${y}`]);
  const queue = [{ x, y }];
  for (let head = 0; head < queue.length; head += 1) {
    const here = queue[head]!;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const next = { x: here.x + dx, y: here.y + dy };
      if (tiles[next.y]?.[next.x] !== "." || seen.has(`${next.x},${next.y}`)) continue;
      seen.add(`${next.x},${next.y}`);
      queue.push(next);
    }
  }
  return seen;
}

function floorCount(tiles: readonly string[]): number {
  return tiles.join("").split(".").length - 1;
}

/** Every socket opens onto floor, all four are mutually reachable, and no floor is stranded. */
function expectConnected(tiles: readonly string[], label: string): void {
  const width = tiles[0]!.length;
  const height = tiles.length;
  const sockets = Object.values(midpointSockets(width, height));
  for (const socket of sockets) {
    expect(tiles[socket.inward.y]![socket.inward.x], `${label}: ${socket.side} inward is floor`).toBe(".");
  }
  const reached = floodFrom(tiles, sockets[0]!.inward.x, sockets[0]!.inward.y);
  for (const socket of sockets) {
    expect(reached.has(`${socket.inward.x},${socket.inward.y}`), `${label}: ${socket.side} socket connects`).toBe(true);
  }
  expect(reached.size, `${label}: no floor pocket remains`).toBe(floorCount(tiles));
}

describe("room shapes", () => {
  it("connects all four sockets with no stranded floor for every shape, size and seed", () => {
    for (const shape of ROOM_SHAPE_IDS) {
      for (const [width, height] of SIZES) {
        for (const seed of SEEDS) {
          const room = generateRoomShape(shape, width, height, createRng(seed));
          const label = `${shape} ${width}x${height} seed ${seed}`;

          expect(room.tiles.length, label).toBe(height);
          expect(room.tiles.every((row) => row.length === width), label).toBe(true);
          expect(/^[#.]+$/.test(room.tiles.join("")), label).toBe(true);
          // The border stays solid: a corridor is cut through a socket wall later, not here.
          expect(room.tiles[0], label).toBe("#".repeat(width));
          expect(room.tiles[height - 1], label).toBe("#".repeat(width));
          expect(room.tiles.every((row) => row[0] === "#" && row[width - 1] === "#"), label).toBe(true);
          expectConnected(room.tiles, label);
        }
      }
    }
  });

  it("is a pure function of the seed", () => {
    for (const shape of ROOM_SHAPE_IDS) {
      expect(generateRoomShape(shape, 11, 9, createRng(7))).toEqual(generateRoomShape(shape, 11, 9, createRng(7)));
    }
    const mazes = new Set(SEEDS.map((seed) => generateRoomShape("maze", 11, 11, createRng(seed)).tiles.join("/")));
    expect(mazes.size).toBeGreaterThan(1);
  });

  it("carves the fewest walls needed, and only inside the border", () => {
    // A solid interior needs exactly the wall tiles between the sockets' inward tiles cut.
    const solid = ["#######", "#######", "#######", "#######", "#######", "#######", "#######"];
    const repaired = repairSockets(solid);
    expectConnected(repaired, "solid");
    // Four inward tiles joined by a spanning path: 4 inward + 6 carved connectors (a plus-shaped tree).
    expect(floorCount(repaired)).toBeLessThanOrEqual(13);
    expect(repaired[0]).toBe("#######");
  });

  it("fills floor pockets nobody can reach", () => {
    const walled = ["#######", "#.....#", "#.###.#", "#.#.#.#", "#.###.#", "#.....#", "#######"];
    const repaired = repairSockets(walled);
    expect(repaired[3]![3]).toBe("#");
    expectConnected(repaired, "pocket");
  });

  it("rejects even and undersized rooms", () => {
    expect(() => generateRoomShape("plain", 8, 9, createRng(1))).toThrow(/odd/);
    expect(() => generateRoomShape("plain", 9, 2, createRng(1))).toThrow(/at least 3/);
  });

  it("retries a thin cavern, then falls back to plain", () => {
    const fallback = generateRoomShape("cavern", 11, 11, createRng(3), { minCavernFloorFraction: 1.1 });
    expect(fallback.shape).toBe("plain");
    expect(fallback.tiles).toEqual(generateRoomShape("plain", 11, 11, createRng(3)).tiles);

    // Every attempt drew from the stream before giving up, and plain draws nothing.
    const spent = createRng(3);
    generateRoomShape("cavern", 11, 11, spent, { minCavernFloorFraction: 1.1 });
    const once = createRng(3);
    generateRoomShape("cavern", 11, 11, once, { minCavernFloorFraction: 0 });
    expect(spent.state()).not.toBe(createRng(3).state());
    expect(spent.state()).not.toBe(once.state());
    expect(CAVERN_ATTEMPTS).toBeGreaterThan(1);
  });

  it("keeps a cavern that meets the floor fraction", () => {
    const caverns = SEEDS.map((seed) => generateRoomShape("cavern", 15, 11, createRng(seed)));
    const kept = caverns.filter((room) => room.shape === "cavern");
    expect(kept.length).toBeGreaterThan(0);
    for (const room of kept) expect(floorCount(room.tiles)).toBeGreaterThanOrEqual(13 * 9 * 0.45);
  });
});

describe("room transforms", () => {
  const TEMPLATE = [
    "#########",
    "#.......#",
    "#.##....#",
    "#.#.#...#",
    "#.......#",
    "#.....#.#",
    "#.....#.#",
    "#.......#",
    "#########",
  ];

  const ALL: RoomTransform[] = [0, 1, 2, 3].flatMap((turns) =>
    [false, true].map((mirror) => ({ turns: turns as RoomTransform["turns"], mirror })),
  );

  it("keeps sockets on side midpoints and the floor count unchanged", () => {
    const tiles = generateRoomShape("pillars", 11, 7, createRng(5)).tiles;
    for (const transform of ALL) {
      const out = transformTiles(tiles, transform);
      const width = out[0]!.length;
      expect(out.length === 7 || out.length === 11).toBe(true);
      expect(floorCount(out)).toBe(floorCount(tiles));
      expectConnected(out, JSON.stringify(transform));
      for (const socket of Object.values(midpointSockets(width, out.length))) {
        expect(out[socket.inward.y]![socket.inward.x]).toBe(".");
      }
    }
  });

  it("maps points the same way it maps tiles", () => {
    for (const transform of ALL) {
      const out = transformTiles(TEMPLATE, transform);
      for (let y = 0; y < TEMPLATE.length; y += 1) {
        for (let x = 0; x < TEMPLATE[0]!.length; x += 1) {
          const to = transformPoint({ x, y }, TEMPLATE[0]!.length, TEMPLATE.length, transform);
          expect(out[to.y]![to.x]).toBe(TEMPLATE[y]![x]);
        }
      }
    }
  });

  it("maps each original socket onto a socket of the transformed room", () => {
    for (const transform of ALL) {
      const width = 11;
      const height = 7;
      const size = transformPoint({ x: 0, y: 0 }, width, height, transform);
      const targets = Object.values(midpointSockets(size.width, size.height)).map((socket) => `${socket.wall.x},${socket.wall.y}`);
      for (const socket of Object.values(midpointSockets(width, height))) {
        const to = transformPoint(socket.wall, width, height, transform);
        expect(targets).toContain(`${to.x},${to.y}`);
      }
    }
  });

  it("rolls every transform from a seeded stream", () => {
    const seen = new Set(SEEDS.map((seed) => JSON.stringify(rollTransform(createRng(seed)))));
    expect(seen.size).toBe(8);
  });

  it("refuses an even-sized template", () => {
    expect(() => transformTiles(["####", "#..#", "####"], { turns: 1, mirror: false })).toThrow(/odd/);
  });

  it("derives doorways on the side midpoints", () => {
    expect(midpointDoorways(7, 5)).toEqual([
      { x: 3, y: 0, side: "north" },
      { x: 3, y: 4, side: "south" },
      { x: 0, y: 2, side: "west" },
      { x: 6, y: 2, side: "east" },
    ]);
  });
});
