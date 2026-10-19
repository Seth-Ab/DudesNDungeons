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
};

/** Longest caption a prop may carry, such as a stall's name. */
export const MAX_PROP_LABEL_LENGTH = 32;

/**
 * How a fixed light glows. `warm` is a torch on a pillar and the default; `red` is reserved for an
 * ominous glow with no torch of its own, which the client does not draw differently yet.
 */
export const LIGHT_TINTS = ["warm", "red"] as const;
