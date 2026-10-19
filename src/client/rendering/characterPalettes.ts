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
