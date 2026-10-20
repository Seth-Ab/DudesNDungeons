/**
 * Bakes `assets/sprites/source/hud.tiles.json` into one PNG per sprite under `assets/sprites/`:
 * `hud-frame.png`, the 9-slice panel frame, and `hud-stud.png`, the brass stud on its corners.
 *
 * Unlike the tilesheet these are not packed into a sheet: CSS `border-image` and `background-image`
 * each load a whole file, so a sprite is its own PNG. The text format, palette and PNG encoder are
 * the ones `spriteSheet.ts` uses, and `tests/client/hudSprites.test.ts` fails if a committed PNG
 * disagrees with the source.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  encodePng,
  expandRows,
  fail,
  parseColor,
  type Bitmap,
  type Rgba,
} from "./spriteSheet.js";

const here = dirname(fileURLToPath(import.meta.url));

export const HUD_SOURCE_PATH = resolve(here, "../assets/sprites/source/hud.tiles.json");

/** Every HUD sprite the baker requires, with the size the CSS in `styles.css` is written against. */
export const HUD_SPRITES = {
  "hud-frame": { width: 16, height: 16 },
  "hud-stud": { width: 8, height: 8 },
} as const;

export type HudSpriteName = keyof typeof HUD_SPRITES;

export const HUD_SPRITE_NAMES = Object.keys(HUD_SPRITES) as HudSpriteName[];

export function hudSpritePath(name: HudSpriteName): string {
  return resolve(here, `../assets/sprites/${name}.png`);
}

interface AuthoredHudSprite {
  width: number;
  height: number;
  rows: string[];
}

export interface HudSourceArt {
  palette: Record<string, string>;
  sprites: Record<string, AuthoredHudSprite>;
}

export function readHudSourceArt(path: string = HUD_SOURCE_PATH): HudSourceArt {
  return JSON.parse(readFileSync(path, "utf8")) as HudSourceArt;
}

function readSprite(
  name: HudSpriteName,
  sprite: AuthoredHudSprite,
  palette: Map<string, Rgba>,
): Bitmap {
  const { width, height } = HUD_SPRITES[name];
  if (sprite.width !== width || sprite.height !== height) {
    fail(`sprite '${name}' is declared ${sprite.width}x${sprite.height} but must be ${width}x${height}`);
  }

  const rows = expandRows(name, sprite.rows);
  if (rows.length !== height) {
    fail(`sprite '${name}' expands to ${rows.length} rows but is declared ${height} pixels tall`);
  }

  const pixels: Rgba[] = [];

  rows.forEach((row, y) => {
    const characters = [...row];
    if (characters.length !== width) {
      fail(`sprite '${name}' row ${y} is ${characters.length} pixels wide, expected ${width}`);
    }

    for (const character of characters) {
      pixels.push(palette.get(character) ?? fail(`sprite '${name}' row ${y} uses '${character}', which is not in the palette`));
    }
  });

  return { width, height, pixels };
}

/** Validates the source and returns each sprite's PNG bytes, keyed by sprite name. */
export function bakeHudSprites(source: HudSourceArt): Record<HudSpriteName, Buffer> {
  const palette = new Map<string, Rgba>(
    Object.entries(source.palette).map(([character, value]) => [character, parseColor(character, value)]),
  );

  const unknown = Object.keys(source.sprites).filter((name) => !(name in HUD_SPRITES));
  if (unknown.length > 0) {
    fail(`source art defines HUD sprites hudSprites.ts never asks for: ${unknown.join(", ")}`);
  }

  const baked = {} as Record<HudSpriteName, Buffer>;
  for (const name of HUD_SPRITE_NAMES) {
    const sprite = source.sprites[name] ?? fail(`hudSprites.ts declares '${name}' but the source art does not provide it`);
    baked[name] = encodePng(readSprite(name, sprite, palette));
  }

  return baked;
}
