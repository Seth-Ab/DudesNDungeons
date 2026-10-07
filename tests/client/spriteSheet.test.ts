import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { SPRITE_NAMES, SPRITE_TILE_SIZE } from "../../src/client/rendering/tiles.js";
import {
  SHEET_PATH,
  SpriteSourceError,
  bakeSheet,
  readSourceArt,
  type SourceArt,
} from "../../scripts/spriteSheet.js";

/** A source with one sprite of the given rows, enough to drive the validation paths. */
function sourceWith(rows: string[]): SourceArt {
  return {
    tileSize: SPRITE_TILE_SIZE,
    palette: { "0": "transparent", "1": "#112233" },
    sprites: { "floor-0": { tilesWide: 1, tilesHigh: 1, rows } },
  };
}

describe("the committed tilesheet", () => {
  it("matches the art it was baked from", () => {
    // The whole point of authoring the art as text: without this, editing the source and forgetting
    // `npm run build:sprites` leaves a PNG that no longer has anything to do with the diff.
    const baked = bakeSheet(readSourceArt());
    const committed = readFileSync(SHEET_PATH);

    expect(
      baked.equals(committed),
      "assets/sprites/dungeon.png is stale; run `npm run build:sprites`",
    ).toBe(true);
  });
});

describe("the source art", () => {
  it("provides every sprite tiles.ts declares", () => {
    // Failing here rather than at runtime is the point: a missing cell is a hole on the floor.
    expect(() => bakeSheet(readSourceArt())).not.toThrow();
  });

  it("names the composed wall cells among the sprites it packs", () => {
    expect(SPRITE_NAMES.filter((name) => /^wall-\d+$/.test(name))).toHaveLength(16);
  });

  it("rejects a sprite with the wrong number of rows", () => {
    expect(() => bakeSheet(sourceWith(["8*1111111111111111"]))).toThrow(SpriteSourceError);
    expect(() => bakeSheet(sourceWith(["8*1111111111111111"]))).toThrow(/8 rows.*16 pixels tall/);
  });

  it("rejects a row of the wrong width", () => {
    expect(() => bakeSheet(sourceWith(["16*111111111111111"]))).toThrow(/15 pixels wide/);
  });

  it("rejects a pixel that is not in the palette", () => {
    const rows = ["15*1111111111111111", "111111111111111z"];
    expect(() => bakeSheet(sourceWith(rows))).toThrow(/'z', which is not in the palette/);
  });

  it("rejects art authored at a different tile size", () => {
    const source = { ...sourceWith(["16*1111111111111111"]), tileSize: 32 };
    expect(() => bakeSheet(source)).toThrow(/tileSize is 32/);
  });

  it("rejects a sprite nothing asks for, so dead art does not accumulate", () => {
    const source = sourceWith(["16*1111111111111111"]);
    source.sprites["floor-spare"] = { tilesWide: 1, tilesHigh: 1, rows: ["16*1111111111111111"] };
    expect(() => bakeSheet(source)).toThrow(/never asks for: floor-spare/);
  });
});
