import { describe, expect, it } from "vitest";
import {
  createLightShader,
  litDarkness,
  REMEMBERED_DARKNESS,
  tileDarkness,
  UNSEEN_DARKNESS,
} from "../../src/client/rendering/lighting.js";

const torch = { position: { x: 0, y: 0 }, radius: 10 };

describe("tile darkness", () => {
  it("leaves unseen and off-window space fully dark", () => {
    expect(tileDarkness(" ", 0, 0, [torch])).toBe(UNSEEN_DARKNESS);
    expect(tileDarkness(null, 0, 0, [torch])).toBe(UNSEEN_DARKNESS);
  });

  it("shades remembered geometry flatly, whatever light is near it", () => {
    // The server decided it is out of sight; a light beside it on the client must not say otherwise.
    expect(tileDarkness(",", 0, 0, [torch])).toBe(REMEMBERED_DARKNESS);
    expect(tileDarkness("+", 0, 0, [torch])).toBe(REMEMBERED_DARKNESS);
  });

  it("always draws a lit tile brighter than a remembered one", () => {
    expect(tileDarkness(".", 9.99, 0, [torch])).toBeLessThan(REMEMBERED_DARKNESS);
    expect(tileDarkness("#", 9.99, 0, [torch])).toBeLessThan(REMEMBERED_DARKNESS);
  });
});

describe("lit darkness", () => {
  it("is brightest at the light and darkens toward its rim", () => {
    const near = litDarkness(1, 0, [torch]);
    const middle = litDarkness(5, 0, [torch]);
    const rim = litDarkness(9.9, 0, [torch]);

    expect(litDarkness(0, 0, [torch])).toBe(0);
    expect(near).toBeLessThan(middle);
    expect(middle).toBeLessThan(rim);
  });

  it("tapers into full darkness at its rim instead of stopping at a visible edge", () => {
    // The last stretch inside the rim changes by far less than the stretch before it, so there is
    // no seam where the lit pool meets the dark around it.
    const step = 0.5;
    const outer = litDarkness(9.99, 0, [torch]) - litDarkness(9.99 - step, 0, [torch]);
    const inner = litDarkness(7, 0, [torch]) - litDarkness(7 - step, 0, [torch]);

    expect(litDarkness(9.99, 0, [torch])).toBeGreaterThan(0.99);
    expect(outer).toBeLessThan(inner);
  });

  it("reads plainly dim across the outer part of a pool, not merely shaded", () => {
    // The outer quarter of a light sits nearer remembered darkness than full brightness.
    expect(litDarkness(7.5, 0, [torch])).toBeGreaterThan(REMEMBERED_DARKNESS / 2);
    expect(litDarkness(9.99, 0, [torch])).toBeGreaterThan(REMEMBERED_DARKNESS * 0.85);
  });

  it("takes the brightest of overlapping lights", () => {
    const pillar = { position: { x: 8, y: 0 }, radius: 4 };

    expect(litDarkness(8, 0, [torch, pillar])).toBe(0);
    expect(litDarkness(8, 0, [torch, pillar])).toBeLessThan(litDarkness(8, 0, [torch]));
  });

  it("draws a lit tile just past a light's rim as dark as the rim, not as unattributed", () => {
    // A wall bordering lit floor, or a tile the last snapshot lit before the torch moved on.
    expect(litDarkness(11, 0, [torch])).toBe(1);
    expect(litDarkness(10, 1, [torch])).toBe(1);
  });

  it("still lights a tile the server lit when no light in view accounts for it", () => {
    const value = litDarkness(50, 50, [torch]);

    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(REMEMBERED_DARKNESS);
  });
});

describe("shading a block of tiles at once", () => {
  /** A grid of every tile kind the snapshot can carry, with unlit, remembered, and off-window cells. */
  const GRID = [
    "          ",
    " ..##..,,+ ",
    " .#..#.,,+ ",
    " ....... . ",
    " ##.....## ",
    "          ",
  ];
  const readTile = (x: number, y: number): string | null => GRID[y]?.[x] ?? null;

  function shadeBlock(
    shade: ReturnType<typeof createLightShader>,
    originX: number,
    originY: number,
    columns: number,
    rows: number,
    lights: readonly { position: { x: number; y: number }; radius: number }[],
  ): Uint8ClampedArray {
    const rgba = new Uint8ClampedArray(columns * rows * 4);
    shade(rgba, columns, rows, originX, originY, readTile, lights);
    return rgba;
  }

  function expected(
    originX: number,
    originY: number,
    columns: number,
    rows: number,
    lights: readonly { position: { x: number; y: number }; radius: number }[],
  ): number[] {
    const alphas: number[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const x = originX + column;
        const y = originY + row;
        alphas.push(Math.round(tileDarkness(readTile(x, y), x, y, lights) * 255));
      }
    }
    return alphas;
  }

  const alphaOf = (rgba: Uint8ClampedArray): number[] =>
    Array.from({ length: rgba.length / 4 }, (_, index) => rgba[index * 4 + 3]!);

  const lights = [
    { position: { x: 3, y: 3 }, radius: 4 },
    { position: { x: 7.5, y: 2.2 }, radius: 3 },
    // Far outside the block, so culling has something to skip.
    { position: { x: 400, y: 400 }, radius: 6 },
    { position: { x: 5, y: 3 }, radius: 0 },
  ];

  it("matches the per-tile answer for every tile, including unseen, remembered and unattributed ones", () => {
    const rgba = shadeBlock(createLightShader(), -2, -1, 14, 8, lights);

    expect(alphaOf(rgba)).toEqual(expected(-2, -1, 14, 8, lights));
  });

  it("takes the brightest of overlapping lights, as the per-tile path does", () => {
    const overlapping = [
      { position: { x: 4, y: 3 }, radius: 5 },
      { position: { x: 4.5, y: 3 }, radius: 2 },
    ];

    expect(alphaOf(shadeBlock(createLightShader(), 0, 0, 10, 6, overlapping))).toEqual(
      expected(0, 0, 10, 6, overlapping),
    );
  });

  it("draws every lit tile at the unattributed shade when no light is in the scene", () => {
    expect(alphaOf(shadeBlock(createLightShader(), 0, 0, 10, 6, []))).toEqual(expected(0, 0, 10, 6, []));
  });

  it("gives the same answer when one shader is reused across different sizes and positions", () => {
    const shade = createLightShader();
    shadeBlock(shade, 0, 0, 14, 8, lights);
    shadeBlock(shade, 3, 1, 3, 2, lights);

    expect(alphaOf(shadeBlock(shade, -1, 0, 12, 7, lights))).toEqual(expected(-1, 0, 12, 7, lights));
  });

  it("writes only the alpha channel", () => {
    const rgba = new Uint8ClampedArray(4 * 4 * 4).fill(7);
    createLightShader()(rgba, 4, 4, 0, 0, readTile, lights);

    for (let index = 0; index < 16; index += 1) {
      expect(Array.from(rgba.slice(index * 4, index * 4 + 3))).toEqual([7, 7, 7]);
    }
  });
});
