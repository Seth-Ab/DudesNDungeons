import {
  DEFAULT_STALL_TINT,
  FACEABLE_PROP_KINDS,
  GROUND_KINDS,
  type GroundKind,
  MAP_PROP_FACINGS,
  MAP_PROP_KINDS,
  MAP_PROP_SIZES,
  STALL_TINTS,
} from "../../shared/constants/scenery.js";
import type {
  ConsumableIcon,
  InventoryItem,
  LootState,
  MapProp,
  MapPropKind,
  MapTheme,
} from "../../shared/types/core.js";
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

/**
 * The wall and floor sprite prefixes each map theme draws with. A theme's walls are composed by the
 * baker from `<wall>-fill` and four `<wall>-edge-*` strips, the same way for every theme. The forest
 * has no floor of its own, so it shares the stone one; the hub covers it with a ground grid.
 *
 * `overhang`, when a theme has one, is laid over a floor tile beside its wall: the forest's canopy
 * reaching half a tile out over the ground, with the shade it casts.
 */
export const THEME_SPRITES: Readonly<Record<MapTheme, { wall: string; floor: string; overhang?: string }>> = {
  stone: { wall: "wall", floor: "floor" },
  forest: { wall: "forest", floor: "floor", overhang: "forest-overhang" },
};

/** How many variants each ground kind picks between. Must match the authored `<kind>-N` sprites. */
export const GROUND_VARIANTS: Readonly<Record<GroundKind, number>> = {
  cobble: 4,
  grass: 3,
  dirt: 2,
};

/** How often each grass or dirt variant comes up. Cobble is picked by `cobbleSprite` instead. */
const GROUND_WEIGHTS: Readonly<Record<Exclude<GroundKind, "cobble">, readonly number[]>> = {
  grass: [6, 3, 2],
  dirt: [3, 2],
};

/**
 * Overlays the baker composes the way it composes walls: four authored strips, `<set>-n`, `-e`, `-s`
 * and `-w`, painted onto a clear cell in every combination. `<set>-<mask>` has the strip for each
 * side whose neighbour bit (below) is set. Mask 0 would be an empty cell, so it is never packed.
 */
export const EDGE_OVERLAY_SETS: readonly string[] = [
  // Grass spilling a ragged fringe onto the cobble or dirt beside it.
  "grass-edge",
  ...Object.values(THEME_SPRITES).flatMap((theme) => (theme.overhang ? [theme.overhang] : [])),
];

/** Grass fringes for a tile that touches grass only at a corner. */
export const GRASS_CORNERS = ["ne", "se", "sw", "nw"] as const;

/** Distinct sprite prefixes for one part of a theme, since themes may share one. */
function themePrefixes(part: "wall" | "floor"): string[] {
  return [...new Set(Object.values(THEME_SPRITES).map((theme) => theme[part]))];
}

/**
 * A prop's sprite. One per kind, named after it, except that a stall has one per awning colour, and
 * a stall or bench facing north has its own, drawn from behind, suffixed `-north`.
 */
export function propSprite(kind: MapPropKind, tint?: MapProp["tint"], facing?: MapProp["facing"]): SpriteName {
  const base = kind === "stall" ? `prop-stall-${tint ?? DEFAULT_STALL_TINT}` : `prop-${kind}`;
  return facing === "north" && FACEABLE_PROP_KINDS.includes(kind) ? `${base}-north` : base;
}

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
 * lookup is arithmetic rather than a string search. Each theme has its own run of walls, and of
 * floors unless it shares one. Order is otherwise only a packing detail; the renderer always goes
 * through `spriteRect`.
 */
const SPRITE_SIZES: ReadonlyArray<readonly [string, SpriteSize]> = [
  ...themePrefixes("wall").flatMap((wall) =>
    Array.from({ length: 16 }, (_unused, mask): readonly [string, SpriteSize] => [
      `${wall}-${mask}`,
      { tilesWide: 1, tilesHigh: 1 },
    ]),
  ),
  ...themePrefixes("floor").flatMap((floor) =>
    Array.from({ length: FLOOR_VARIANTS }, (_unused, variant): readonly [string, SpriteSize] => [
      `${floor}-${variant}`,
      { tilesWide: 1, tilesHigh: 1 },
    ]),
  ),
  ...Object.entries(GROUND_VARIANTS).flatMap(([kind, count]) =>
    Array.from({ length: count }, (_unused, variant): readonly [string, SpriteSize] => [
      `${kind}-${variant}`,
      { tilesWide: 1, tilesHigh: 1 },
    ]),
  ),
  ...EDGE_OVERLAY_SETS.flatMap((set) =>
    Array.from({ length: 15 }, (_unused, index): readonly [string, SpriteSize] => [
      `${set}-${index + 1}`,
      { tilesWide: 1, tilesHigh: 1 },
    ]),
  ),
  ...GRASS_CORNERS.map((corner): readonly [string, SpriteSize] => [
    `grass-corner-${corner}`,
    { tilesWide: 1, tilesHigh: 1 },
  ]),
  // A pillar is two tiles tall and stands on its light's position, so the flame sits above the
  // floor the light was authored on rather than buried in it.
  ["torch-pillar", { tilesWide: 1, tilesHigh: 2 }],
  ["torch-flame", { tilesWide: 1, tilesHigh: 1 }],
  // The ground under a campfire light; the flame over it is `torch-flame`.
  ["campfire-logs", { tilesWide: 1, tilesHigh: 1 }],
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
  ["loot-draught", { tilesWide: 1, tilesHigh: 1 }],
  ["loot-flare", { tilesWide: 1, tilesHigh: 1 }],
  ["loot-salts", { tilesWide: 1, tilesHigh: 1 }],
  // A flare once it is lit and lying where it was put down: drawn over its light, like a pillar.
  ["flare-lit", { tilesWide: 1, tilesHigh: 1 }],
  ["loot-skill-scroll", { tilesWide: 1, tilesHigh: 1 }],
  // The fallback for a weapon without its own art in `WEAPON_SPRITES`.
  ["loot-weapon", { tilesWide: 1, tilesHigh: 1 }],
  ["loot-rusted-sword", { tilesWide: 1, tilesHigh: 1 }],
  ["loot-arrow", { tilesWide: 1, tilesHigh: 1 }],
  // Unlit, because this is a torch lying on the floor. The flame is `torch-flame`, drawn over the
  // player once they are carrying it and it is an active light source.
  ["loot-torch", { tilesWide: 1, tilesHigh: 1 }],
  // Drawn at twice a loot sprite's size, so a reward spot reads from across the room.
  ["chest-closed", { tilesWide: 1, tilesHigh: 1 }],
  ["chest-open", { tilesWide: 1, tilesHigh: 1 }],
  ["exit-stairs", { tilesWide: 4, tilesHigh: 4 }],
  // Scenery, at the footprint the server validated it against.
  ...MAP_PROP_KINDS.flatMap((kind): Array<readonly [string, SpriteSize]> => {
    const tints = kind === "stall" ? STALL_TINTS : [undefined];
    const facings = FACEABLE_PROP_KINDS.includes(kind) ? MAP_PROP_FACINGS : [undefined];
    return tints.flatMap((tint) =>
      facings.map((facing) => [propSprite(kind, tint, facing), MAP_PROP_SIZES[kind]] as const),
    );
  }),
];

export type SpriteName = string;

/**
 * Loot sprite per item kind. Exhaustive rather than defaulted: a new `itemKind` should fail the
 * client build and get its own art, not quietly spawn on the floor wearing something else's.
 */
export const LOOT_SPRITES: Record<Exclude<LootState["kind"], "consumable">, SpriteName> = {
  key: "loot-key",
  skillScroll: "loot-skill-scroll",
  torch: "loot-torch",
  weapon: "loot-weapon",
  // Arrows are the only ammo so far; a second kind gets its own art the way weapons do.
  ammo: "loot-arrow",
};

/** A consumable names its icon in content, so its art is looked up by that rather than by kind. */
export const CONSUMABLE_SPRITES: Record<ConsumableIcon, SpriteName> = {
  tonic: "loot-tonic",
  ward: "loot-ward",
  draught: "loot-draught",
  flare: "loot-flare",
  salts: "loot-salts",
};

/**
 * A weapon's art by content id. Defaulted rather than exhaustive, because content ids are data: a
 * weapon added to `content/items/` before its art still draws, as the generic `loot-weapon`.
 */
export const WEAPON_SPRITES: Readonly<Record<string, SpriteName>> = {
  "rusted-sword": "loot-rusted-sword",
};

/** The sprite for anything that can lie on the floor or sit in a hotbar slot. */
export function itemSprite(item: LootState | InventoryItem): SpriteName {
  if (item.kind === "consumable") return CONSUMABLE_SPRITES[item.icon];
  if (item.kind === "weapon") return WEAPON_SPRITES[item.itemId] ?? LOOT_SPRITES.weapon;
  return LOOT_SPRITES[item.kind];
}


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
 * The tile alphabet the renderer reads.
 *
 * `#` and `.` are lit; `+` and `,` are remembered from an earlier visit; a space is space the viewer
 * has never seen, and is not drawn at all. The client's map holds only `#`, `.` and spaces; the
 * shader gets `+` and `,` from `shadingTile` in `lighting.ts`, for tiles the snapshot did not light.
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

export function wallSprite(mask: number, theme: MapTheme = "stone"): SpriteName {
  return `${THEME_SPRITES[theme].wall}-${mask}`;
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
export function floorSprite(x: number, y: number, theme: MapTheme = "stone"): SpriteName {
  return `${THEME_SPRITES[theme].floor}-${weightedVariant(tileHash(x, y), FLOOR_WEIGHTS)}`;
}

function tileHash(x: number, y: number): number {
  let hash = Math.imul(x, 0x1f1f1f1f) ^ Math.imul(y, 0x27d4eb2d);
  hash = Math.imul(hash ^ (hash >>> 15), 0x2c1b3c6d);
  hash = Math.imul(hash ^ (hash >>> 12), 0x297a2d39);
  hash ^= hash >>> 15;
  return hash >>> 0;
}

function weightedVariant(hash: number, weights: readonly number[]): number {
  let roll = hash % weights.reduce((total, weight) => total + weight, 0);

  for (let variant = 0; variant < weights.length; variant += 1) {
    roll -= weights[variant] as number;
    if (roll < 0) return variant;
  }

  return 0;
}

/** A ground grid character as a kind, or `null` for `.`, unseen space, or anything else. */
export function groundKind(character: string | null | undefined): GroundKind | null {
  return GROUND_KINDS[character as keyof typeof GROUND_KINDS] ?? null;
}

/**
 * Which cobble a tile draws with, so that no two tiles sharing an edge are the same stone.
 *
 * A checkerboard splits the four variants in two: a tile picks one of the first pair, by hash, when
 * `x + y` is even, and one of the second pair when it is odd. Every edge neighbour sits on the other
 * colour of the board, so it can never match, and the hash keeps either half from settling into a
 * pattern the eye picks out.
 */
export function cobbleSprite(x: number, y: number): SpriteName {
  return `cobble-${((x + y) & 1) * 2 + (tileHash(x, y) & 1)}`;
}

/** What a floor tile draws as: its ground kind's variant, or the theme's own floor for `.`. */
export function groundSprite(ground: string | null, x: number, y: number, theme: MapTheme = "stone"): SpriteName {
  const kind = groundKind(ground);
  if (kind === null) return floorSprite(x, y, theme);
  if (kind === "cobble") return cobbleSprite(x, y);
  return `${kind}-${weightedVariant(tileHash(x, y), GROUND_WEIGHTS[kind])}`;
}

/** Reads a floor tile's ground character, or `null` for a wall, unseen space, or off the map. */
export type GroundReader = (x: number, y: number) => string | null;

/**
 * The grass fringes laid over a floor tile that is not grass itself: one composed edge for the sides
 * that touch grass, and a corner piece for each diagonal that does when neither side beside it is
 * grass already. Grass itself is never fringed, so wherever it meets cobble or dirt the ragged edge
 * falls on the other side of the line, one tile deep.
 */
export function grassFringes(readGround: GroundReader, x: number, y: number): SpriteName[] {
  if (groundKind(readGround(x, y)) === "grass") return [];
  const grass = (dx: number, dy: number): boolean => groundKind(readGround(x + dx, y + dy)) === "grass";

  const north = grass(0, -1);
  const east = grass(1, 0);
  const south = grass(0, 1);
  const west = grass(-1, 0);
  const mask =
    (north ? NEIGHBOUR_NORTH : 0) |
    (east ? NEIGHBOUR_EAST : 0) |
    (south ? NEIGHBOUR_SOUTH : 0) |
    (west ? NEIGHBOUR_WEST : 0);

  const sprites: SpriteName[] = mask === 0 ? [] : [`grass-edge-${mask}`];
  if (!north && !east && grass(1, -1)) sprites.push("grass-corner-ne");
  if (!south && !east && grass(1, 1)) sprites.push("grass-corner-se");
  if (!south && !west && grass(-1, 1)) sprites.push("grass-corner-sw");
  if (!north && !west && grass(-1, -1)) sprites.push("grass-corner-nw");
  return sprites;
}

/**
 * The theme's overhang over a floor tile, for each side where a known wall stands, or `null` when
 * there is none. Unlike `wallMask`, unknown space does not count: the canopy only reaches out of
 * forest the viewer has seen, so it never sketches the edge of somewhere unexplored.
 */
export function overhangSprite(
  readTile: TileReader,
  x: number,
  y: number,
  theme: MapTheme = "stone",
): SpriteName | null {
  const set = THEME_SPRITES[theme].overhang;
  if (!set) return null;
  const wall = (nx: number, ny: number): boolean => {
    const tile = readTile(nx, ny);
    return tile === LIT_WALL || tile === KNOWN_WALL;
  };

  const mask =
    (wall(x, y - 1) ? NEIGHBOUR_NORTH : 0) |
    (wall(x + 1, y) ? NEIGHBOUR_EAST : 0) |
    (wall(x, y + 1) ? NEIGHBOUR_SOUTH : 0) |
    (wall(x - 1, y) ? NEIGHBOUR_WEST : 0);
  return mask === 0 ? null : `${set}-${mask}`;
}
