import type { EquippedCosmetics, LightSourceState } from "../../shared/types/core.js";
import { FLAME_RAMPS, HEARTH_FLAME_RAMP, type FlameRamp } from "./characterPalettes.js";

/**
 * Torch flames (#138): a cosmetic that recolours the flame a player carries, and nothing more.
 *
 * Free of the DOM so it can be tested under node. The flame sprite is baked in the hearth ramp's
 * `e f g h`, so wearing a flame is a palette swap of those four colours on that one sprite, plus a
 * faint halo tint. The light itself, its position, radius and the lightmap it feeds, is the
 * server's and is never touched here: light stays a fair, shared resource.
 */

const FLAME_KEYS = ["e", "f", "g", "h"] as const;

/** The ramp a flame id draws, with no flame, or one the client has no art for, as the hearth. */
export function flameRamp(flameId: string | null): FlameRamp {
  if (flameId === null || !Object.hasOwn(FLAME_RAMPS, flameId)) return HEARTH_FLAME_RAMP;
  return FLAME_RAMPS[flameId as keyof typeof FLAME_RAMPS];
}

/** Whether a flame id draws anything other than the baked hearth flame. */
export function isRecolouredFlame(flameId: string | null): boolean {
  return flameRamp(flameId) !== HEARTH_FLAME_RAMP;
}

function rgb(hex: string): number {
  return Number.parseInt(hex.slice(1), 16);
}

/**
 * Each baked flame colour, as `0xrrggbb`, mapped to the one this flame draws instead, for
 * `recolourPixels`. Empty for the hearth flame, which is what the sprite already is.
 */
export function flameSwaps(flameId: string | null): ReadonlyMap<number, number> {
  const ramp = flameRamp(flameId);
  const swaps = new Map<number, number>();
  if (ramp === HEARTH_FLAME_RAMP) return swaps;
  for (const key of FLAME_KEYS) swaps.set(rgb(HEARTH_FLAME_RAMP[key]), rgb(ramp[key]));
  return swaps;
}

/**
 * The flame a light source draws: its bearer's when it is a carried torch, since a carried torch
 * shares its bearer's id; otherwise null, the hearth flame every fixed light, campfire and pillar
 * keeps.
 */
export function lightFlameId(
  light: Pick<LightSourceState, "id" | "kind">,
  players: readonly { id: string; cosmetics: Pick<EquippedCosmetics, "flame"> }[],
): string | null {
  if (light.kind !== "carriedTorch") return null;
  return players.find((player) => player.id === light.id)?.cosmetics.flame ?? null;
}

/**
 * The faint tint added around a recoloured flame, as an `rgba()` colour, or null for the hearth
 * flame, which keeps the warm halo every light has.
 */
export function flameHaloTint(flameId: string | null): string | null {
  if (!isRecolouredFlame(flameId)) return null;
  const glow = rgb(flameRamp(flameId).g);
  return `rgba(${glow >> 16}, ${(glow >> 8) & 0xff}, ${glow & 0xff}, 0.22)`;
}
