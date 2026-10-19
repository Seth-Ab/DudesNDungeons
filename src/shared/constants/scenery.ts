/**
 * What an authored map may dress itself in: a visual theme and a list of props.
 *
 * Shared because the server validates a prop against its footprint and the client draws it at that
 * size, and the two must agree on both. None of it is collision. A prop is a picture over tiles the
 * map already has, so anything a player should not walk through still needs `#` beneath it.
 */

/**
 * How a map draws its `#` and `.` tiles. `stone` is dungeon masonry and the default; `forest` draws
 * walls as dense woodland, which is the hub.
 */
export const MAP_THEMES = ["stone", "forest"] as const;

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
] as const;

/**
 * Each prop's footprint in world tiles: the size its sprite is drawn at, from the prop's top-left.
 * An authored prop is placed in authored tiles, so a 4x4 prop exactly covers one authored tile.
 */
export const MAP_PROP_SIZES: Readonly<
  Record<(typeof MAP_PROP_KINDS)[number], { tilesWide: number; tilesHigh: number }>
> = {
  fountain: { tilesWide: 4, tilesHigh: 4 },
  stall: { tilesWide: 8, tilesHigh: 4 },
  "quest-board": { tilesWide: 8, tilesHigh: 4 },
  tree: { tilesWide: 4, tilesHigh: 4 },
  bush: { tilesWide: 2, tilesHigh: 2 },
  "dungeon-gate": { tilesWide: 12, tilesHigh: 8 },
  sign: { tilesWide: 2, tilesHigh: 2 },
  "hanging-lantern": { tilesWide: 1, tilesHigh: 2 },
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
 * fire on the ground; `none` draws nothing of its own, for a light whose source is a prop already
 * in the scene, such as a hanging lantern.
 */
export const LIGHT_FIXTURES = ["pillar", "campfire", "none"] as const;

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
  fountain: { x: 2, y: 3.55, rx: 2.15, ry: 0.7 },
  stall: { x: 4, y: 3.8, rx: 4.1, ry: 0.45 },
  "quest-board": { x: 4, y: 3.75, rx: 3.6, ry: 0.5 },
  tree: { x: 2, y: 3.6, rx: 1.7, ry: 0.55 },
  bush: { x: 1, y: 1.75, rx: 0.95, ry: 0.35 },
  sign: { x: 1, y: 1.85, rx: 0.55, ry: 0.2 },
};
