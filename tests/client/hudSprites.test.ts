import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  HUD_SPRITE_NAMES,
  HUD_SPRITES,
  bakeHudSprites,
  hudSpritePath,
  readHudSourceArt,
  type HudSourceArt,
} from "../../scripts/hudSprites.js";
import { SpriteSourceError } from "../../scripts/spriteSheet.js";

/** A source with both sprites blank apart from the rows given for the frame, to drive validation. */
function sourceWith(frameRows: string[]): HudSourceArt {
  const blank = (size: number) => Array.from({ length: size }, () => "0".repeat(size));
  return {
    palette: { "0": "transparent", "1": "#112233" },
    sprites: {
      "hud-frame": { width: 16, height: 16, rows: frameRows },
      "hud-stud": { width: 8, height: 8, rows: blank(8) },
    },
  };
}

describe("the committed HUD sprites", () => {
  it.each(HUD_SPRITE_NAMES)("%s matches the art it was baked from", (name) => {
    // Same guard as the tilesheet: editing hud.tiles.json without `npm run build:sprites` fails here.
    const baked = bakeHudSprites(readHudSourceArt())[name];
    const committed = readFileSync(hudSpritePath(name));

    expect(baked.equals(committed), `assets/sprites/${name}.png is stale; run \`npm run build:sprites\``).toBe(
      true,
    );
  });

  it("bakes the frame at the size the 9-slice CSS slices (16 px, 4 px border) and the 8 px stud", () => {
    const baked = bakeHudSprites(readHudSourceArt());

    for (const name of HUD_SPRITE_NAMES) {
      const png = baked[name];
      expect(png.readUInt32BE(16), `${name} width`).toBe(HUD_SPRITES[name].width);
      expect(png.readUInt32BE(20), `${name} height`).toBe(HUD_SPRITES[name].height);
    }
  });
});

describe("the HUD source art", () => {
  it("provides every sprite hudSprites.ts declares", () => {
    expect(() => bakeHudSprites(readHudSourceArt())).not.toThrow();
  });

  it("rejects a frame with the wrong number of rows", () => {
    const rows = ["8*" + "1".repeat(16)];
    expect(() => bakeHudSprites(sourceWith(rows))).toThrow(SpriteSourceError);
    expect(() => bakeHudSprites(sourceWith(rows))).toThrow(/8 rows.*16 pixels tall/);
  });

  it("rejects a row of the wrong width and names the row", () => {
    const rows = ["15*" + "1".repeat(16), "1".repeat(15)];
    expect(() => bakeHudSprites(sourceWith(rows))).toThrow(/row 15 is 15 pixels wide, expected 16/);
  });

  it("rejects a pixel character that is not in the palette", () => {
    const rows = ["15*" + "1".repeat(16), "x".repeat(16)];
    expect(() => bakeHudSprites(sourceWith(rows))).toThrow(/'x'.*not in the palette/);
  });

  it("rejects a missing sprite and a sprite nothing asks for", () => {
    const missing = sourceWith(["16*" + "1".repeat(16)]);
    delete missing.sprites["hud-stud"];
    expect(() => bakeHudSprites(missing)).toThrow(/declares 'hud-stud'/);

    const extra = sourceWith(["16*" + "1".repeat(16)]);
    extra.sprites["hud-crown"] = { width: 8, height: 8, rows: [] };
    expect(() => bakeHudSprites(extra)).toThrow(/never asks for: hud-crown/);
  });
});
