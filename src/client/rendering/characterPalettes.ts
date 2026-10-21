import type { HairColor, PartyColor, SkinTone } from "../../shared/types/core.js";

/**
 * The real colours a character's key-colour ramps are swapped for, keyed by the shared appearance
 * ids. Copied from the `SKIN`, `HAIRC` and `PARTY` tables in
 * `docs/design/character-sprite-bible.html`, which the owner approved; change them there first.
 *
 * Every ramp is light, mid, shadow, the same order as `CHARACTER_KEY_COLOURS`, so a key colour and
 * its replacement share an index.
 */
export type ColourRamp = readonly [light: string, mid: string, shadow: string];

export const SKIN_RAMPS: Record<SkinTone, ColourRamp> = {
  porcelain: ["#f8e0cc", "#ecc4a8", "#c9967a"],
  fair: ["#f2cba2", "#dca87e", "#b3805b"],
  olive: ["#dcb07e", "#c0905f", "#946b43"],
  tan: ["#c99060", "#a77046", "#7c5030"],
  brown: ["#a26a44", "#80502f", "#5c3720"],
  deep: ["#7a4c2e", "#5c3720", "#3f2516"],
};

export const HAIR_RAMPS: Record<HairColor, ColourRamp> = {
  black: ["#4b4552", "#2d2933", "#1c1a20"],
  brown: ["#94603a", "#6b4226", "#4a2c18"],
  chestnut: ["#c06c40", "#94502c", "#66331a"],
  blonde: ["#f6dc94", "#dab35e", "#a8843c"],
  ginger: ["#f0954a", "#c95d22", "#8a3a14"],
  silver: ["#eeeae2", "#bfb8ac", "#878074"],
  azure: ["#8fb4ec", "#5279be", "#334e85"],
  moss: ["#9ad088", "#5f9c52", "#3c6a34"],
};

export interface PartyPalette {
  /** The ring at a player's feet and the tint of their name. */
  ring: string;
  /** The tunic, until a dye replaces it. */
  tunic: ColourRamp;
}

export const PARTY_PALETTES: Record<PartyColor, PartyPalette> = {
  ember: { ring: "#f08a48", tunic: ["#e07a3a", "#b5502a", "#7b2f18"] },
  moss: { ring: "#7fd08f", tunic: ["#6aa860", "#47803f", "#2c5428"] },
  azure: { ring: "#8fb0f0", tunic: ["#6f8fd0", "#4a66a8", "#2f4275"] },
  plum: { ring: "#d29ae0", tunic: ["#a06aaa", "#7a4785", "#4f2b58"] },
};

/**
 * What a cosmetic's key colours become, in the order `COSMETIC_KEY_COLOURS` lists the keys; null
 * for a key the item does not use. A legendary item's `flicker` swaps some of them on a period, the
 * one small animation the bible allows it. Copied from the bible's `hats` and `cloaks` tables.
 */
export interface CosmeticPalette {
  colours: readonly (string | null)[];
  flicker?: { periodMs: number; colours: readonly (string | null)[] };
}

/** Ramp light, mid, shadow, then the accents `r w y f`. Keyed by cosmetic content id. */
export const HAT_PALETTES = {
  "leather-cap": { colours: ["#a07a4a", "#7a5a34", "#4e3a22", null, null, null, null] },
  "ranger-hood": { colours: ["#5d7d58", "#3f5a3c", "#243424", null, null, null, null] },
  "feathered-cap": { colours: ["#6a86c4", "#3f5486", "#2a3860", "#d0453a", null, null, null] },
  "iron-helm": { colours: ["#d2d7de", "#8a929e", "#545b66", null, null, null, null] },
  "mushroom-cap": { colours: ["#d04434", "#8c2a20", "#ead9b8", null, "#f6eedd", null, null] },
  "horned-helm": { colours: ["#aeb6c1", "#6f7782", "#444b55", null, "#ece0c4", null, null] },
  "wizard-hat": { colours: ["#7466cc", "#4a3f99", "#2e2766", null, null, "#f6d860", null] },
  "ember-crown": {
    colours: ["#f6cf62", "#d6a84c", "#8c6a2a", "#c2551d", null, null, "#f0a83c"],
    // The embers along the crown's tips.
    flicker: { periodMs: 200, colours: [null, null, null, null, null, null, "#ffe6a3"] },
  },
} as const satisfies Record<string, CosmeticPalette>;

/** The shared cloak shape's six colours, per cloak. Keyed by cosmetic content id. */
export const CLOAK_PALETTES = {
  "traveler-cape": { colours: ["#8a6a44", "#6a4f30", "#45331e", "#d6a84c", "#8a6a44", "#45331e"] },
  "night-cloak": { colours: ["#3a4466", "#262d48", "#161a2c", "#cfd6dc", "#eef0f6", "#161a2c"] },
  "moth-cloak": { colours: ["#d4cab2", "#a89c80", "#6e6450", "#6e6450", "#3b2f20", "#6e6450"] },
  "ember-cloak": {
    colours: ["#a8361e", "#7b1f14", "#4a120c", "#f0a83c", "#c2551d", "#f0a83c"],
    // The hem, which never quite goes out.
    flicker: { periodMs: 160, colours: [null, null, "#c2551d", null, null, "#ffe6a3"] },
  },
} as const satisfies Record<string, CosmeticPalette>;

/** Outfit dyes replace the tunic ramp. Keyed by cosmetic content id. */
export const DYE_RAMPS = {
  "bone-dye": ["#ece0c4", "#c8b996", "#8e8064"],
  "ashen-dye": ["#adafb3", "#76797f", "#4a4c51"],
  "midnight-dye": ["#4a5470", "#2c3348", "#171b28"],
  "crimson-dye": ["#d8503f", "#9e2a24", "#641812"],
  "gilded-dye": ["#f6cf62", "#c9962e", "#7d5a18"],
} as const satisfies Record<string, ColourRamp>;

/** How a trail's particles move, from the bible's trail swing: one style per trail. */
export type TrailStyle = "sparks" | "shards" | "wisps" | "petals" | "glint";

/**
 * A weapon trail: four colours from the arc's inner edge to its outer one, and how its particles
 * move. Copied from the bible's `trails` table.
 */
export interface TrailPalette {
  style: TrailStyle;
  colours: readonly [string, string, string, string];
}

/** Keyed by cosmetic content id. No trail draws only the swing. */
export const TRAIL_PALETTES = {
  "ember-sparks": { style: "sparks", colours: ["#7b1f14", "#c2551d", "#f0a83c", "#ffe6a3"] },
  "frost-shards": { style: "shards", colours: ["#2f4275", "#6f8fd0", "#bcd6f6", "#ffffff"] },
  "shadow-wisps": { style: "wisps", colours: ["#1b1424", "#3c2a52", "#6a4f8e", "#a68ccc"] },
  "petal-drift": { style: "petals", colours: ["#8a3a52", "#d06a8a", "#f2a6bc", "#fde2ea"] },
  "gilded-glint": { style: "glint", colours: ["#7d5a18", "#c9962e", "#f6cf62", "#fff6d0"] },
} as const satisfies Record<string, TrailPalette>;

/** The torch flame's four key letters in `dungeon.tiles.json`, darkest first. */
export interface FlameRamp {
  e: string;
  f: string;
  g: string;
  h: string;
}

/**
 * The default flame, exactly the `e f g h` the torch sprite is baked in, so wearing no flame swaps
 * nothing. Copied from the bible's `flames.hearth`.
 */
export const HEARTH_FLAME_RAMP: FlameRamp = { e: "#7b1f14", f: "#c2551d", g: "#f0a83c", h: "#ffe6a3" };

/** Keyed by cosmetic content id. Copied from the bible's `flames` table. */
export const FLAME_RAMPS = {
  "spirit-flame": { e: "#1d2f7b", f: "#3d63c9", g: "#7fb0f0", h: "#e0f0ff" },
  witchfire: { e: "#14502a", f: "#2f9a48", g: "#8ce07a", h: "#eaffd0" },
  "amethyst-flame": { e: "#4a1d6e", f: "#8a3dc2", g: "#c48cf0", h: "#f4e0ff" },
  bonefire: { e: "#6e665a", f: "#b0a89a", g: "#e8e0d0", h: "#ffffff" },
} as const satisfies Record<string, FlameRamp>;
