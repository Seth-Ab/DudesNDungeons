import type { ItemKind } from "../../shared/types/core.js";
/**
 * What the tilesheet contains and which cell a given tile draws with.
 *
 * Deliberately free of the DOM and of the sheet itself. `scripts/buildSprites.ts` imports this to
 * decide what to bake and where to put it, the renderer imports it to decide what to stamp, and
 * `tests/client/tiles.test.ts` drives it under the node test environment. One declaration, so the
 * baked sheet and the renderer's reads cannot drift the way two hand-kept lists would.
 */

/** Art pixels per world tile. Drawn at 2x, so a world tile is 32 screen pixels and reads chunky. */
export const SPRITE_TILE_SIZE = 16;

/** How many sprite cells fit across the sheet before it wraps. */
const SHEET_COLUMNS = 16;

/** How many floor variants a floor tile picks between. Must match the authored `floor-N` sprites. */
export const FLOOR_VARIANTS = 4;

/**
 * How often each floor variant comes up, relative to the others.
 *
 * Heavily weighted to plain stone, which is not what an even split gives you. A world tile is a
 * quarter of an authored one, so an even split puts a crack or a chip on every other tile and the
 * floor reads as rubble under a hailstorm rather than as masonry. Damage has to be rare enough to
 * be worth noticing.
 */
const FLOOR_WEIGHTS: readonly number[] = [24, 3, 3, 2];
const FLOOR_WEIGHT_TOTAL = FLOOR_WEIGHTS.reduce((total, weight) => total + weight, 0);

export interface SpriteRect {
  /** Left edge in the sheet, in art pixels. */
  x: number;
  /** Top edge in the sheet, in art pixels. */
  y: number;
  /** Width in art pixels. */
  width: number;
  /** Height in art pixels. */
  height: number;
}

/** A sprite's footprint, in world tiles. Anything wider or taller than 1 is drawn as one piece. */
interface SpriteSize {
  tilesWide: number;
  tilesHigh: number;
}

/**
 * Every sprite the sheet holds, in the order it is packed.
 *
 * Walls come first as a contiguous run of sixteen, indexed by the neighbour mask below, so a wall
 * lookup is arithmetic rather than a string search. Order is otherwise only a packing detail; the
 * renderer always goes through `spriteRect`.
 */
const SPRITE_SIZES: ReadonlyArray<readonly [string, SpriteSize]> = [
  ...Array.from({ length: 16 }, (_unused, mask): readonly [string, SpriteSize] => [
    `wall-${mask}`,
    { tilesWide: 1, tilesHigh: 1 },
  ]),
  ...Array.from({ length: FLOOR_VARIANTS }, (_unused, variant): readonly [string, SpriteSize] => [
    `floor-${variant}`,
    { tilesWide: 1, tilesHigh: 1 },
  ]),
  // A pillar is two tiles tall and stands on its light's position, so the flame sits above the
  // floor the light was authored on rather than buried in it.
  ["torch-pillar", { tilesWide: 1, tilesHigh: 2 }],
  ["torch-flame", { tilesWide: 1, tilesHigh: 1 }],
  ["glow-mote", { tilesWide: 1, tilesHigh: 1 }],
  // Door leaves tile along the opening rather than stretching across it, because an opening is
  // `TILE_SCALE` world tiles wide and one stretched sprite would be drawn at four times its size.
  ["door-closed-h", { tilesWide: 1, tilesHigh: 1 }],
  ["door-closed-v", { tilesWide: 1, tilesHigh: 1 }],
  // An open door is not a leaf to tile but a pair of jambs stamped at the ends of the opening, so
  // the floor the party is about to walk over shows through the gap between them.
  ["door-jamb-h", { tilesWide: 1, tilesHigh: 1 }],
  ["door-jamb-v", { tilesWide: 1, tilesHigh: 1 }],
  ["door-lock", { tilesWide: 1, tilesHigh: 1 }],
  ["loot-key", { tilesWide: 1, tilesHigh: 1 }],
  ["loot-tonic", { tilesWide: 1, tilesHigh: 1 }],
  ["loot-ward", { tilesWide: 1, tilesHigh: 1 }],
  ["loot-skill-scroll", { tilesWide: 1, tilesHigh: 1 }],
  // Unlit, because this is a torch lying on the floor. The flame is `torch-flame`, drawn over the
  // player once they are carrying it and it is an active light source.
  ["loot-torch", { tilesWide: 1, tilesHigh: 1 }],
  ["exit-stairs", { tilesWide: 4, tilesHigh: 4 }],
];

export type SpriteName = string;

/**
 * Loot sprite per item kind. Exhaustive rather than defaulted: a new `itemKind` should fail the
 * client build and get its own art, not quietly spawn on the floor wearing something else's.
 */
export const LOOT_SPRITES: Record<ItemKind, SpriteName> = {
  key: "loot-key",
  tonic: "loot-tonic",
  ward: "loot-ward",
  skillScroll: "loot-skill-scroll",
  torch: "loot-torch",
};


/**
 * Packs the sprites into a sheet.
 *
 * A shelf packer: sprites are laid left to right and a row is as tall as its tallest sprite. Not
 * the tightest packing there is, and it does not need to be - the sheet is a few kilobytes and is
 * decoded once. What it buys is that the layout is a pure function of `SPRITE_SIZES`, so adding a
 * sprite moves the others without anyone having to restate a coordinate.
 */
function packSheet(): { rects: Map<SpriteName, SpriteRect>; width: number; height: number } {
  const rects = new Map<SpriteName, SpriteRect>();
  const sheetWidth = SHEET_COLUMNS * SPRITE_TILE_SIZE;
  let cursorX = 0;
  let cursorY = 0;
  let rowHeight = 0;

  for (const [name, size] of SPRITE_SIZES) {
    const width = size.tilesWide * SPRITE_TILE_SIZE;
    const height = size.tilesHigh * SPRITE_TILE_SIZE;

    if (cursorX + width > sheetWidth) {
      cursorX = 0;
      cursorY += rowHeight;
      rowHeight = 0;
    }

    rects.set(name, { x: cursorX, y: cursorY, width, height });
    cursorX += width;
    rowHeight = Math.max(rowHeight, height);
  }

  return { rects, width: sheetWidth, height: cursorY + rowHeight };
}

const sheet = packSheet();

export const SHEET_WIDTH = sheet.width;
export const SHEET_HEIGHT = sheet.height;

/** Every sprite name the sheet must provide, in packing order. The baker validates against this. */
export const SPRITE_NAMES: readonly SpriteName[] = SPRITE_SIZES.map(([name]) => name);

export function spriteRect(name: SpriteName): SpriteRect {
  const rect = sheet.rects.get(name);
  if (!rect) throw new Error(`Unknown sprite: ${name}`);
  return rect;
}

/**
 * The tile alphabet a snapshot carries, from `src/server/game/visibility.ts`.
 *
 * `#` and `.` are lit; `+` and `,` are remembered from an earlier visit and draw dim; a space is
 * space the viewer has never seen, and is not drawn at all.
 */
export const LIT_WALL = "#";
export const LIT_FLOOR = ".";
export const KNOWN_WALL = "+";
export const KNOWN_FLOOR = ",";
export const UNKNOWN = " ";

export type TileSurface = "wall" | "floor";

export interface TileLook {
  surface: TileSurface;
  /** True for geometry the viewer remembers rather than currently sees. */
  dim: boolean;
}

/**
 * How a tile character should be drawn, or `null` for space nobody has seen.
 *
 * Anything outside the alphabet is read as lit floor. That is the forgiving direction: a character
 * this file has not met is far likelier to be a surface someone added - a hub flagstone, a puzzle
 * plate - than a wall, and drawing a wall where there is none tells the player they cannot walk
 * somewhere the server will happily let them walk. Add the character here once it has its own art.
 */
export function tileLook(tile: string): TileLook | null {
  switch (tile) {
    case UNKNOWN:
      return null;
    case LIT_WALL:
      return { surface: "wall", dim: false };
    case KNOWN_WALL:
      return { surface: "wall", dim: true };
    case KNOWN_FLOOR:
      return { surface: "floor", dim: true };
    default:
      return { surface: "floor", dim: false };
  }
}

/** Neighbour mask bits. A set bit means that side continues as wall, so no edge is drawn there. */
export const NEIGHBOUR_NORTH = 1;
export const NEIGHBOUR_EAST = 2;
export const NEIGHBOUR_SOUTH = 4;
export const NEIGHBOUR_WEST = 8;

/** Reads a tile out of a snapshot window, or `null` when the window does not reach that far. */
export type TileReader = (x: number, y: number) => string | null;

/**
 * Whether a wall at `(x, y)` joins its neighbour, per side.
 *
 * A neighbour counts as wall when it is wall, and also when it is unknown or off the edge of the
 * window. Treating undiscovered space as floor would cut a lit edge into the wall wherever the
 * viewer's knowledge stops, which both looks wrong and quietly draws the shape of what they have
 * not explored onto their screen. A wall running off into the dark is the truthful picture.
 */
export function wallMask(readTile: TileReader, x: number, y: number): number {
  const joins = (nx: number, ny: number): boolean => {
    const tile = readTile(nx, ny);
    if (tile === null || tile === UNKNOWN) return true;
    return tile === LIT_WALL || tile === KNOWN_WALL;
  };

  return (
    (joins(x, y - 1) ? NEIGHBOUR_NORTH : 0) |
    (joins(x + 1, y) ? NEIGHBOUR_EAST : 0) |
    (joins(x, y + 1) ? NEIGHBOUR_SOUTH : 0) |
    (joins(x - 1, y) ? NEIGHBOUR_WEST : 0)
  );
}

export function wallSprite(mask: number): SpriteName {
  return `wall-${mask}`;
}

/** Whether a tile blocks sight and movement, counting unknown and off-window space as solid. */
function isSolid(tile: string | null): boolean {
  return tile === null || tile === LIT_WALL || tile === KNOWN_WALL || tile === UNKNOWN;
}

/** Which way a door leaf stands: `h` for planks running east-west, `v` for a leaf across a corridor. */
export type DoorOrientation = "h" | "v";

/**
 * Which way a doorway runs, read off the map rather than sent by the server.
 *
 * `doorState` carries a centre and a span but no orientation, because the server collides against a
 * square either way. A doorway punched through a wall that runs east-west has wall to its east and
 * west, and the leaf filling it lies flat along that wall; anything else is a leaf standing across
 * a corridor. Purely presentational: getting it wrong turns the planks ninety degrees and changes
 * nothing about what a player can walk through.
 *
 * `centreX`/`centreY` are the door's centre and `size` its span, both in world units.
 */
export function doorOrientation(
  readTile: TileReader,
  centreX: number,
  centreY: number,
  size: number,
): DoorOrientation {
  const half = size / 2;
  const row = Math.round(centreY);

  const west = readTile(Math.round(centreX - half - 0.5), row);
  const east = readTile(Math.round(centreX + half + 0.5), row);

  return isSolid(west) && isSolid(east) ? "h" : "v";
}

/**
 * Which floor variant a tile draws with.
 *
 * A hash of the coordinates rather than a random draw, so a cracked flagstone stays in the same
 * place every frame, on every client, and after a reconnect. Per-frame randomness here would make
 * a large sparse hall shimmer, which is worse than the tiling it was meant to break up.
 */
export function floorSprite(x: number, y: number): SpriteName {
  let hash = Math.imul(x, 0x1f1f1f1f) ^ Math.imul(y, 0x27d4eb2d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d);
  hash = Math.imul(hash ^ (hash >>> 12), 0x297a2d39);
  hash ^= hash >>> 15;

  let roll = (hash >>> 0) % FLOOR_WEIGHT_TOTAL;

  for (let variant = 0; variant < FLOOR_WEIGHTS.length; variant += 1) {
    roll -= FLOOR_WEIGHTS[variant] as number;
    if (roll < 0) return `floor-${variant}`;
  }

  return "floor-0";
}
