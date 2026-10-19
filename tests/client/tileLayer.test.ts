import { describe, expect, it } from "vitest";
import { createTileLayer, CHUNK_TILES, SurfaceGrid } from "../../src/client/rendering/tileLayer.js";
import type { DungeonMapState } from "../../src/shared/types/core.js";

const SIZE = CHUNK_TILES * 2;

function windowOf(rows: string[], originX = 0, originY = 0, width = SIZE, height = SIZE): DungeonMapState {
  return { id: "t", name: "t", width, height, originX, originY, tiles: rows };
}

/** A map of one repeated row, so a test can name exactly the tiles it cares about. */
function filled(char: string, columns = SIZE, rows = SIZE): string[] {
  return Array.from({ length: rows }, () => char.repeat(columns));
}

function withTile(rows: string[], x: number, y: number, char: string): string[] {
  return rows.map((row, index) => (index === y ? row.slice(0, x) + char + row.slice(x + 1) : row));
}

describe("SurfaceGrid", () => {
  it("dirties the chunks a snapshot first reveals, and nothing when the same snapshot arrives again", () => {
    const grid = new SurfaceGrid(SIZE, SIZE);
    const map = windowOf(filled("."));

    expect(grid.merge(map).size).toBe(4);
    expect(grid.merge(windowOf(filled("."))).size).toBe(0);
  });

  it("treats a lit tile turning remembered as no change, because the lightmap owns that", () => {
    const grid = new SurfaceGrid(SIZE, SIZE);
    grid.merge(windowOf(filled(".")));

    expect(grid.merge(windowOf(filled(","))).size).toBe(0);
  });

  it("dirties a chunk when a remembered floor tile is found to be wall", () => {
    const grid = new SurfaceGrid(SIZE, SIZE);
    grid.merge(windowOf(filled(",")));

    expect(grid.merge(windowOf(withTile(filled(","), 5, 5, "#")))).toEqual(new Set([0]));
  });

  it("does not dirty anything when the window slides over tiles already known", () => {
    const grid = new SurfaceGrid(SIZE, SIZE);
    grid.merge(windowOf(filled(".")));

    const slid = windowOf(filled(".", 40, 40), 10, 10);
    expect(grid.merge(slid).size).toBe(0);
  });

  it("remembers a tile after it scrolls out of the window", () => {
    const grid = new SurfaceGrid(SIZE, SIZE);
    grid.merge(windowOf(withTile(filled(","), 3, 3, "#")));
    grid.merge(windowOf(filled(".", 10, 10), 50, 50));

    expect(grid.at(3, 3)).toBe(2);
    expect(grid.at(60, 60)).toBe(1);
  });

  it("dirties the neighbouring chunk when a change sits on a chunk edge", () => {
    const grid = new SurfaceGrid(SIZE, SIZE);
    grid.merge(windowOf(filled(".")));

    // The last column of the first chunk: the wall's neighbour to the east is in chunk 1.
    const dirty = grid.merge(windowOf(withTile(filled("."), CHUNK_TILES - 1, 5, "#")));
    expect([...dirty].sort()).toEqual([0, 1]);
  });

  it("reads outside the world as unseen", () => {
    const grid = new SurfaceGrid(SIZE, SIZE);
    grid.merge(windowOf(filled(".")));

    expect(grid.at(-1, 0)).toBe(0);
    expect(grid.at(SIZE, 0)).toBe(0);
  });
});

describe("the tile layer", () => {
  /** Fakes for the drawing surfaces: stamps and blits are recorded, and nothing needs a browser. */
  const fakeContext = { clearRect: () => undefined };

  function harness() {
    const stamps: string[] = [];
    const blits: number[][] = [];
    const layer = createTileLayer({
      tileset: { draw: (_context: typeof fakeContext, name: string) => void stamps.push(name) },
      createSurface: () => ({ image: "chunk", context: fakeContext }),
    });
    const target = {
      drawImage: (_image: string, ...rest: number[]) => void blits.push(rest),
    };
    const toScreen = (x: number, y: number) => ({ x: x * 32, y: y * 32 });
    const draw = () =>
      layer.draw(target, { minX: 0, maxX: SIZE - 1, minY: 0, maxY: SIZE - 1 }, toScreen, 32);
    return { layer, draw, stamps, blits };
  }

  it("stamps each tile once and then only blits on later frames", () => {
    const { layer, draw, stamps, blits } = harness();
    layer.sync(windowOf(filled(".")), "dungeon");
    draw();
    const stamped = stamps.length;

    expect(stamped).toBe(SIZE * SIZE);
    expect(blits).toHaveLength(4);

    draw();
    layer.sync(windowOf(filled(".")), "dungeon");
    draw();
    expect(stamps).toHaveLength(stamped);
    expect(blits).toHaveLength(12);
  });

  it("restamps only the chunks a discovery touches", () => {
    const { layer, draw, stamps } = harness();
    layer.sync(windowOf(filled(".")), "dungeon");
    draw();
    stamps.length = 0;

    layer.sync(windowOf(withTile(filled("."), 5, 5, "#")), "dungeon");
    draw();
    expect(stamps).toHaveLength(CHUNK_TILES * CHUNK_TILES);
  });

  it("edges a wall by its neighbours, treating unseen space as wall", () => {
    const { layer, draw, stamps } = harness();
    const rows = filled(" ");
    layer.sync(windowOf(withTile(rows, 1, 1, "#")), "dungeon");
    draw();

    // North, east, south and west all unseen, so the wall continues on every side: mask 15.
    expect(stamps).toEqual(["wall-15"]);
  });

  it("draws a forest-themed map as woodland and cobbles", () => {
    const { layer, draw, stamps } = harness();
    const rows = withTile(filled(" "), 1, 1, "#");
    layer.sync({ ...windowOf(withTile(rows, 2, 1, ".")), theme: "forest" }, "hub");
    draw();

    expect(stamps).toHaveLength(2);
    expect(stamps).toContain("forest-13");
    expect(stamps.find((name) => name !== "forest-13")).toMatch(/^cobble-\d$/);
  });

  it("restamps everything when the same world changes theme", () => {
    const { layer, draw, stamps } = harness();
    layer.sync(windowOf(filled(".")), "hub");
    draw();
    stamps.length = 0;

    layer.sync({ ...windowOf(filled(".")), theme: "forest" }, "hub");
    draw();
    expect(stamps).toHaveLength(SIZE * SIZE);
    expect(stamps.every((name) => name.startsWith("cobble-"))).toBe(true);
  });

  it("starts clean for a new world, even at the same size", () => {
    const { layer, draw, stamps } = harness();
    layer.sync(windowOf(filled(".")), "hub");
    draw();
    stamps.length = 0;

    layer.sync(windowOf(filled(".")), "dungeon");
    draw();
    expect(stamps).toHaveLength(SIZE * SIZE);
  });

  it("places neighbouring chunks edge to edge", () => {
    const { layer, draw, blits } = harness();
    layer.sync(windowOf(filled(".")), "dungeon");
    draw();

    const first = blits[0]!;
    const second = blits[1]!;
    // After the image: source x, y, width, height, then destination x, y, width, height. Chunk 1
    // begins exactly where chunk 0 ends.
    expect(second[4]).toBe(first[4]! + first[6]!);
  });

  it("evicts chunks that are off screen once too many are cached, and rebuilds them on return", () => {
    const { layer, stamps } = harness();
    const target = { drawImage: () => undefined };
    const toScreen = (x: number, y: number) => ({ x, y });
    const width = CHUNK_TILES * 30;
    layer.sync(windowOf(filled(".", width, CHUNK_TILES), 0, 0, width, CHUNK_TILES), "dungeon");

    // Walk the view along thirty chunks, then come back to the first.
    for (let chunk = 0; chunk < 30; chunk += 1) {
      layer.draw(target, { minX: chunk * CHUNK_TILES, maxX: chunk * CHUNK_TILES, minY: 0, maxY: 0 }, toScreen, 32);
    }
    stamps.length = 0;
    layer.draw(target, { minX: 0, maxX: 0, minY: 0, maxY: 0 }, toScreen, 32);

    expect(stamps).toHaveLength(CHUNK_TILES * CHUNK_TILES);
  });
});
