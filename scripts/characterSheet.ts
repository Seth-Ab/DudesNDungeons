/**
 * Bakes the authored character layers in `assets/sprites/source/characters.tiles.json` into
 * `assets/sprites/characters.png`.
 *
 * The same idea as `spriteSheet.ts`, which it borrows the palette, row and PNG handling from, but
 * for 16 x 24 character frames rather than 16 x 16 tiles. Kept apart so
 * `tests/client/characterSheet.test.ts` can bake a sheet and compare it against the committed one.
 *
 * The baker also derives the walk frames, so the renderer only ever picks a cell: hand-authoring
 * them would be eighteen more frames that each differ from a standing one by a few boot pixels.
 * Seated, attack and downed frames are authored: they differ by more than a boot. The downed frame is
 * the one that is not 16 x 24; it sits in a band of its own under the standing frames.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  CHARACTER_BODY_TOP,
  CHARACTER_FIXED_COLOURS,
  CHARACTER_FRAME_HEIGHT,
  CHARACTER_FRAME_WIDTH,
  CHARACTER_FRAMES,
  CHARACTER_KEY_COLOURS,
  CHARACTER_LAYERS,
  CHARACTER_SHEET_HEIGHT,
  CHARACTER_SHEET_WIDTH,
  COSMETIC_KEY_COLOURS,
  characterFrameRect,
  type WalkPose,
} from "../src/client/rendering/characters.js";
import {
  CLEAR,
  encodePng,
  expandRows,
  fail,
  parseColor,
  type Bitmap,
  type Rgba,
} from "./spriteSheet.js";

const here = dirname(fileURLToPath(import.meta.url));

export const CHARACTER_SOURCE_PATH = resolve(here, "../assets/sprites/source/characters.tiles.json");
export const CHARACTER_SHEET_PATH = resolve(here, "../assets/sprites/characters.png");

interface AuthoredLayer {
  rows: string[];
}

export interface CharacterSourceArt {
  frameWidth: number;
  frameHeight: number;
  palette: Record<string, string>;
  layers: Record<string, AuthoredLayer>;
}

/** Every colour a character may be baked in: the fixed colours and the key colours, cosmetics' too. */
export const CHARACTER_COLOURS: ReadonlySet<string> = new Set(
  [
    ...Object.values(CHARACTER_FIXED_COLOURS),
    ...Object.values(CHARACTER_KEY_COLOURS).flat(),
    ...Object.values(COSMETIC_KEY_COLOURS).flat(),
  ].map((colour) => colour.toLowerCase()),
);

/** The two body rows the walk cycle touches: the boots, and the trouser row above them. */
const FOOT_ROW = CHARACTER_BODY_TOP + 15;
const LIFTED_FOOT_ROW = CHARACTER_BODY_TOP + 14;

/** Which columns of the frame lift their foot in each walk pose. */
const LIFTED_COLUMNS: Record<Exclude<WalkPose, "stand">, readonly [number, number]> = {
  walk1: [CHARACTER_FRAME_WIDTH / 2, CHARACTER_FRAME_WIDTH - 1],
  walk2: [0, CHARACTER_FRAME_WIDTH / 2 - 1],
};

export function readCharacterSourceArt(path: string = CHARACTER_SOURCE_PATH): CharacterSourceArt {
  return JSON.parse(readFileSync(path, "utf8")) as CharacterSourceArt;
}

function readPalette(source: CharacterSourceArt): Map<string, Rgba> {
  const palette = new Map<string, Rgba>();

  for (const [character, value] of Object.entries(source.palette)) {
    const color = parseColor(character, value);
    // Anything else would bake a colour the renderer neither swaps nor expects, and a near miss on a
    // key colour would silently stop that pixel recolouring.
    if (color[3] > 0 && !CHARACTER_COLOURS.has(value.toLowerCase())) {
      fail(
        `palette entry '${character}' is ${value}, which is neither a key colour nor a fixed ` +
          "colour in characters.ts",
      );
    }
    palette.set(character, color);
  }

  return palette;
}

function readLayer(
  name: string,
  layer: AuthoredLayer,
  palette: Map<string, Rgba>,
  frameWidth: number,
  frameHeight: number,
): Bitmap {
  const rows = expandRows(name, layer.rows, "layer");

  if (rows.length !== frameHeight) {
    fail(`layer '${name}' expands to ${rows.length} rows but a frame is ${frameHeight} pixels tall`);
  }

  const pixels: Rgba[] = [];

  rows.forEach((row, y) => {
    const characters = [...row];
    if (characters.length !== frameWidth) {
      fail(`layer '${name}' row ${y} is ${characters.length} pixels wide, expected ${frameWidth}`);
    }

    for (const character of characters) {
      const color = palette.get(character);
      if (!color) fail(`layer '${name}' row ${y} uses '${character}', which is not in the palette`);
      pixels.push(color);
    }
  });

  return { width: frameWidth, height: frameHeight, pixels };
}

/**
 * Lifts one half of the legs a row, the way the reference's `lift()` does: each boot pixel in the
 * columns moves up onto the trouser row, and the row it left is cleared.
 */
function liftFoot(frame: Bitmap, [from, to]: readonly [number, number]): Bitmap {
  const pixels = frame.pixels.slice();

  for (let x = from; x <= to; x += 1) {
    const foot = FOOT_ROW * frame.width + x;
    const boot = pixels[foot] ?? CLEAR;
    if (boot[3] > 0) pixels[LIFTED_FOOT_ROW * frame.width + x] = boot;
    pixels[foot] = CLEAR;
  }

  return { ...frame, pixels };
}

function poseFrame(layer: Bitmap, pose: WalkPose): Bitmap {
  return pose === "stand" ? layer : liftFoot(layer, LIFTED_COLUMNS[pose]);
}

/** Validates the source against what `characters.ts` declares, and returns the sheet as PNG bytes. */
export function bakeCharacterSheet(source: CharacterSourceArt): Buffer {
  if (source.frameWidth !== CHARACTER_FRAME_WIDTH || source.frameHeight !== CHARACTER_FRAME_HEIGHT) {
    fail(
      `source frames are ${source.frameWidth}x${source.frameHeight} but characters.ts bakes ` +
        `${CHARACTER_FRAME_WIDTH}x${CHARACTER_FRAME_HEIGHT}`,
    );
  }

  const palette = readPalette(source);

  const unused = Object.keys(source.layers).filter((name) => !CHARACTER_LAYERS.includes(name));
  if (unused.length > 0) {
    fail(`source art defines layers characters.ts never asks for: ${unused.join(", ")}`);
  }

  const layers = new Map<string, Bitmap>();
  for (const name of CHARACTER_LAYERS) {
    const layer = source.layers[name];
    if (!layer) fail(`characters.ts declares layer '${name}' but the source art does not provide it`);
    const frame = CHARACTER_FRAMES.find((candidate) => candidate.layer === name)!;
    layers.set(name, readLayer(name, layer, palette, frame.width, frame.height));
  }

  const sheet: Bitmap = {
    width: CHARACTER_SHEET_WIDTH,
    height: CHARACTER_SHEET_HEIGHT,
    pixels: new Array<Rgba>(CHARACTER_SHEET_WIDTH * CHARACTER_SHEET_HEIGHT).fill(CLEAR),
  };

  for (const frame of CHARACTER_FRAMES) {
    const bitmap = poseFrame(layers.get(frame.layer) as Bitmap, frame.pose);
    const rect = characterFrameRect(frame.name);

    for (let y = 0; y < frame.height; y += 1) {
      for (let x = 0; x < frame.width; x += 1) {
        sheet.pixels[(rect.y + y) * CHARACTER_SHEET_WIDTH + rect.x + x] =
          bitmap.pixels[y * frame.width + x] ?? CLEAR;
      }
    }
  }

  return encodePng(sheet);
}
