/**
 * Bakes the authored pixel text in `assets/sprites/source/` into a PNG tilesheet.
 *
 * The art is authored as text so it is reviewable: a pull request that moves a flagstone shows
 * which pixels moved, the same way `content/` shows which monster got faster. The PNG is the build
 * product the browser loads, and an artist who would rather use a paint program can overwrite it
 * directly - nothing in the client reads the source JSON.
 *
 * Kept apart from `buildSprites.ts` so `tests/client/spriteSheet.test.ts` can bake a sheet and
 * compare it against the committed one. Without that, the two drift the first time somebody edits
 * the source and forgets to run the command, and nothing notices until a tile looks wrong.
 */

import { deflateSync } from "node:zlib";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  SHEET_HEIGHT,
  SHEET_WIDTH,
  SPRITE_NAMES,
  SPRITE_TILE_SIZE,
  spriteRect,
} from "../src/client/rendering/tiles.js";

const here = dirname(fileURLToPath(import.meta.url));

export const SOURCE_PATH = resolve(here, "../assets/sprites/source/dungeon.tiles.json");
export const SHEET_PATH = resolve(here, "../assets/sprites/dungeon.png");

const TRANSPARENT = "transparent";

/** Authored pieces the wall cells are composed from. They are not packed into the sheet. */
const WALL_FILL = "wall-fill";
const WALL_EDGES = ["wall-edge-n", "wall-edge-e", "wall-edge-s", "wall-edge-w"] as const;

interface AuthoredSprite {
  tilesWide: number;
  tilesHigh: number;
  rows: string[];
}

export interface SourceArt {
  tileSize: number;
  palette: Record<string, string>;
  sprites: Record<string, AuthoredSprite>;
}

/** Straight RGBA. A source palette entry is opaque hex or the literal `transparent`. */
export type Rgba = readonly [number, number, number, number];

/** A sprite as pixels: `width * height` colours, row-major. */
export interface Bitmap {
  width: number;
  height: number;
  pixels: Rgba[];
}

export const CLEAR: Rgba = [0, 0, 0, 0];

/** Thrown for anything wrong with the source art, so the CLI and the test report it the same way. */
export class SpriteSourceError extends Error {}

export function fail(message: string): never {
  throw new SpriteSourceError(message);
}

export function parseColor(name: string, value: string): Rgba {
  if (value === TRANSPARENT) return CLEAR;

  const match = /^#([0-9a-fA-F]{6})$/.exec(value);
  if (!match?.[1]) fail(`palette entry '${name}' is neither '${TRANSPARENT}' nor #rrggbb: ${value}`);

  const hex = Number.parseInt(match[1], 16);
  return [(hex >> 16) & 0xff, (hex >> 8) & 0xff, hex & 0xff, 255];
}

/** Expands the `N*row` shorthand. A palette character is never `*`, so the prefix is unambiguous. */
export function expandRows(name: string, rows: string[], kind = "sprite"): string[] {
  const expanded: string[] = [];

  for (const row of rows) {
    const match = /^(\d+)\*(.*)$/.exec(row);
    if (!match?.[1] || match[2] === undefined) {
      expanded.push(row);
      continue;
    }

    const count = Number.parseInt(match[1], 10);
    if (count < 1) fail(`${kind} '${name}' repeats a row ${count} times`);
    for (let repeat = 0; repeat < count; repeat += 1) expanded.push(match[2]);
  }

  return expanded;
}

function readSprite(name: string, sprite: AuthoredSprite, palette: Map<string, Rgba>): Bitmap {
  const width = sprite.tilesWide * SPRITE_TILE_SIZE;
  const height = sprite.tilesHigh * SPRITE_TILE_SIZE;
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
      const color = palette.get(character);
      if (!color) fail(`sprite '${name}' row ${y} uses '${character}', which is not in the palette`);
      pixels.push(color);
    }
  });

  return { width, height, pixels };
}

/** Paints `over` onto a copy of `under`, skipping fully transparent source pixels. */
function overlay(under: Bitmap, over: Bitmap): Bitmap {
  if (under.width !== over.width || under.height !== over.height) {
    fail("cannot overlay sprites of different sizes");
  }

  return {
    width: under.width,
    height: under.height,
    pixels: under.pixels.map((base, index) => {
      const top = over.pixels[index];
      return top && top[3] > 0 ? top : base;
    }),
  };
}

/**
 * Builds the sixteen wall cells from one fill and four edge strips.
 *
 * Composing rather than authoring sixteen cells by hand is what guarantees that the lip on a corner
 * cell lines up with the lip on the straight cell beside it. Hand-drawn, the sixteen would drift by
 * a pixel somewhere, and it would only show up on a stretch of wall nobody had walked yet.
 *
 * The south face is painted last, over the side lips rather than under them, so a wall exposed on
 * two sides shows an unbroken face with the side lip returning into it. That ordering is why there
 * are no separate corner sprites: the strips already meet correctly.
 */
function composeWalls(authored: Map<string, Bitmap>): Map<string, Bitmap> {
  const piece = (name: string): Bitmap => {
    const bitmap = authored.get(name);
    if (!bitmap) fail(`source art is missing '${name}', which the wall cells are composed from`);
    return bitmap;
  };

  const fill = piece(WALL_FILL);
  const north = piece("wall-edge-n");
  const east = piece("wall-edge-e");
  const west = piece("wall-edge-w");
  const south = piece("wall-edge-s");

  const walls = new Map<string, Bitmap>();

  for (let mask = 0; mask < 16; mask += 1) {
    let cell = fill;
    // A set bit means that side continues as wall, so its edge is the one side *not* drawn.
    if ((mask & 1) === 0) cell = overlay(cell, north);
    if ((mask & 2) === 0) cell = overlay(cell, east);
    if ((mask & 8) === 0) cell = overlay(cell, west);
    if ((mask & 4) === 0) cell = overlay(cell, south);
    walls.set(`wall-${mask}`, cell);
  }

  return walls;
}

function crcTable(): Uint32Array {
  const table = new Uint32Array(256);

  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c >>> 0;
  }

  return table;
}

const CRC_TABLE = crcTable();

function crc32(bytes: Buffer): number {
  let c = 0xffffffff;
  for (const byte of bytes) c = (CRC_TABLE[(c ^ byte) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Buffer): Buffer {
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([length, body, crc]);
}

/**
 * Encodes 8-bit RGBA, non-interlaced, with every scanline on filter 0.
 *
 * No filtering, because the art is flat colour in long runs, which deflate already handles, and an
 * unfiltered image is one fewer thing to get subtly wrong in a file nothing else here can read.
 * Deterministic, which is what lets a test compare the bytes against the committed sheet.
 */
export function encodePng(image: Bitmap): Buffer {
  const stride = image.width * 4;
  const raw = Buffer.alloc((stride + 1) * image.height);

  for (let y = 0; y < image.height; y += 1) {
    const rowStart = y * (stride + 1);
    raw[rowStart] = 0;
    for (let x = 0; x < image.width; x += 1) {
      const color = image.pixels[y * image.width + x] ?? CLEAR;
      const at = rowStart + 1 + x * 4;
      raw[at] = color[0];
      raw[at + 1] = color[1];
      raw[at + 2] = color[2];
      raw[at + 3] = color[3];
    }
  }

  const header = Buffer.alloc(13);
  header.writeUInt32BE(image.width, 0);
  header.writeUInt32BE(image.height, 4);
  header[8] = 8; // bit depth
  header[9] = 6; // colour type: truecolour with alpha
  header[10] = 0; // deflate
  header[11] = 0; // adaptive filtering
  header[12] = 0; // no interlace

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(raw, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

export function readSourceArt(path: string = SOURCE_PATH): SourceArt {
  return JSON.parse(readFileSync(path, "utf8")) as SourceArt;
}

/** Validates the source art against what `tiles.ts` declares, and returns the sheet as PNG bytes. */
export function bakeSheet(source: SourceArt): Buffer {
  if (source.tileSize !== SPRITE_TILE_SIZE) {
    fail(`source tileSize is ${source.tileSize} but tiles.ts bakes at ${SPRITE_TILE_SIZE}`);
  }

  const palette = new Map<string, Rgba>(
    Object.entries(source.palette).map(([character, value]) => [
      character,
      parseColor(character, value),
    ]),
  );

  const authored = new Map<string, Bitmap>(
    Object.entries(source.sprites).map(([name, sprite]) => [
      name,
      readSprite(name, sprite, palette),
    ]),
  );

  // Checked before anything is composed or packed, so the report names the sprite that should not
  // be there rather than the first one that happens to be missing further down.
  const composition = new Set<string>([WALL_FILL, ...WALL_EDGES]);
  const unused = [...authored.keys()].filter(
    (name) => !SPRITE_NAMES.includes(name) && !composition.has(name),
  );
  if (unused.length > 0) {
    fail(`source art defines sprites tiles.ts never asks for: ${unused.join(", ")}`);
  }

  const available = new Map<string, Bitmap>([...authored, ...composeWalls(authored)]);

  const sheet: Bitmap = {
    width: SHEET_WIDTH,
    height: SHEET_HEIGHT,
    pixels: new Array<Rgba>(SHEET_WIDTH * SHEET_HEIGHT).fill(CLEAR),
  };

  for (const name of SPRITE_NAMES) {
    const bitmap = available.get(name);
    if (!bitmap) fail(`tiles.ts declares sprite '${name}' but the source art does not provide it`);

    const rect = spriteRect(name);
    if (bitmap.width !== rect.width || bitmap.height !== rect.height) {
      fail(
        `sprite '${name}' is ${bitmap.width}x${bitmap.height} but tiles.ts reserves ` +
          `${rect.width}x${rect.height} for it`,
      );
    }

    for (let y = 0; y < rect.height; y += 1) {
      for (let x = 0; x < rect.width; x += 1) {
        sheet.pixels[(rect.y + y) * SHEET_WIDTH + rect.x + x] =
          bitmap.pixels[y * rect.width + x] ?? CLEAR;
      }
    }
  }

  return encodePng(sheet);
}
