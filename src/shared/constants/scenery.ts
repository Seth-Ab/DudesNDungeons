/**
 * What an authored map may dress itself in: a visual theme and a list of props.
 *
 * Shared because the server validates a prop against its footprint and the client draws it at that
 * size, and the two must agree on both. None of it is collision. A prop is a picture over tiles the
 * map already has, so anything a player should not walk through still needs `#` beneath it.
 */

/**
 * How a map draws its `#` and `.` tiles. `stone` is dungeon masonry and the default; `forest` draws
 * walls as dense woodland, which is the hub. `crypt`, `fungal` and `ossuary` are the biomes' own
 * wall and floor palettes: drowned blue-grey, mossy earth and pale bone.
 */
export const MAP_THEMES = ["stone", "forest", "crypt", "fungal", "ossuary"] as const;

export const DEFAULT_MAP_THEME = "stone";

export const MAP_PROP_KINDS = [
  "fountain",
  "stall",
  "quest-board",
  "tree",
  "bush",
  "dungeon-gate",
  "sign",
  "hanging-lantern",
  "bench",
  "log",
  "campfire",
] as const;

/**
 * Each prop's footprint in world tiles: the size its sprite is drawn at, from the prop's top-left.
 * An authored prop is placed in authored tiles, so a 4x4 prop exactly covers one authored tile.
 */
export const MAP_PROP_SIZES: Readonly<
  Record<(typeof MAP_PROP_KINDS)[number], { tilesWide: number; tilesHigh: number }>
> = {
  // Three authored tiles square: the hub's centrepiece, with a ring road round it.
  fountain: { tilesWide: 12, tilesHigh: 12 },
  stall: { tilesWide: 8, tilesHigh: 4 },
  "quest-board": { tilesWide: 8, tilesHigh: 4 },
  tree: { tilesWide: 4, tilesHigh: 4 },
  bush: { tilesWide: 2, tilesHigh: 2 },
  "dungeon-gate": { tilesWide: 12, tilesHigh: 8 },
  sign: { tilesWide: 2, tilesHigh: 2 },
  "hanging-lantern": { tilesWide: 1, tilesHigh: 2 },
  // A whole authored tile, the solid block a bench or log stands on, with the picture across its
  // middle; something to sit on round the fountain and the campfire.
  bench: { tilesWide: 4, tilesHigh: 4 },
  log: { tilesWide: 4, tilesHigh: 4 },
  // The stone pit round a campfire light, which draws its own logs and flame in the middle. It lies
  // flat on open floor, because a light on a solid tile shines on nothing.
  campfire: { tilesWide: 4, tilesHigh: 4 },
};

/**
 * Which way a prop faces. Art is drawn facing `south`, toward the viewer, and that is the default.
 * A stall or bench south of what it serves faces `north`, and is drawn from behind.
 */
export const MAP_PROP_FACINGS = ["south", "north"] as const;

export const DEFAULT_PROP_FACING = "south";

/** The kinds with art for facing north. Content refuses `facing` on any other. */
export const FACEABLE_PROP_KINDS: readonly (typeof MAP_PROP_KINDS)[number][] = ["stall", "bench"];

/**
 * Which way a seat faces: the side a sitter looks out over, and the side they stand up onto. A bench
 * seats people facing the way the bench does, and the fountain rim faces out on all four sides.
 */
export const SEAT_FACINGS = ["north", "south", "east", "west"] as const;

export type SeatFacing = (typeof SEAT_FACINGS)[number];

/** A seat's facing as a unit world vector, which is also the facing a sitter is given. */
export const SEAT_FACING_VECTORS: Readonly<Record<SeatFacing, { x: number; y: number }>> = {
  north: { x: 0, y: -1 },
  south: { x: 0, y: 1 },
  east: { x: 1, y: 0 },
  west: { x: -1, y: 0 },
};

/** Longest caption a prop may carry, such as a stall's name. */
export const MAX_PROP_LABEL_LENGTH = 32;

/**
 * How a fixed light glows. `warm` is a torch on a pillar and the default; `red` is reserved for an
 * ominous glow with no torch of its own, which the client does not draw differently yet.
 */
export const LIGHT_TINTS = ["warm", "red"] as const;

/**
 * What a fixed light is drawn as. `pillar` is a torch on a stand and the default; `campfire` is a
 * fire on the ground; `candle` is a tall candle on a shrine's floor; `none` draws nothing of its
 * own, for a light whose source is a prop already in the scene, such as a hanging lantern.
 */
export const LIGHT_FIXTURES = ["pillar", "campfire", "candle", "none"] as const;

/**
 * What an authored map's optional `ground` grid may say about a floor tile: grass, cobble or dirt,
 * or `.` for whatever the theme draws by default. Render-only: collision is always `tiles`, and
 * ground under a wall is ignored.
 */
export const GROUND_KINDS = { g: "grass", c: "cobble", d: "dirt" } as const;

export type GroundKind = (typeof GROUND_KINDS)[keyof typeof GROUND_KINDS];

export const DEFAULT_GROUND = ".";

/** One row of a ground grid: only the characters above. */
export const GROUND_ROW_PATTERN = /^[gcd.]+$/;

/**
 * A stall's awning colour, over a cream shared by all four. Muted on purpose: the hub's big
 * surfaces stay quiet so whatever a player can use carries the accent.
 */
export const STALL_TINTS = ["ember", "moss", "azure", "plum"] as const;

export const DEFAULT_STALL_TINT = "ember";

/**
 * Where a prop's contact shadow sits, in world tiles from its top-left: an ellipse centred at
 * `x`/`y` with radii `rx`/`ry`. Drawn on the ground before any prop, so the prop seems to stand on
 * the floor rather than be pasted over it. A kind without an entry casts none; the gate is built
 * into the forest edge and the canopy already shades it.
 */
export const MAP_PROP_SHADOWS: Readonly<
  Partial<Record<(typeof MAP_PROP_KINDS)[number], { x: number; y: number; rx: number; ry: number }>>
> = {
  fountain: { x: 6, y: 10.6, rx: 6.1, ry: 1.5 },
  stall: { x: 4, y: 3.8, rx: 4.1, ry: 0.45 },
  "quest-board": { x: 4, y: 3.75, rx: 3.6, ry: 0.5 },
  tree: { x: 2, y: 3.6, rx: 1.7, ry: 0.55 },
  bush: { x: 1, y: 1.75, rx: 0.95, ry: 0.35 },
  sign: { x: 1, y: 1.85, rx: 0.55, ry: 0.2 },
  bench: { x: 2, y: 3.2, rx: 1.9, ry: 0.35 },
  log: { x: 2, y: 2.85, rx: 1.8, ry: 0.35 },
};
