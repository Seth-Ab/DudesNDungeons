import type { Vector2 } from "../../shared/types/core.js";
import { KNOWN_FLOOR, KNOWN_WALL, UNKNOWN } from "./tiles.js";

/**
 * How dark each tile on screen should be drawn, as an alpha for a near-black overlay.
 *
 * Free of the DOM so it can be tested under node, like `tiles.ts`. The renderer turns one value per
 * tile into a tiny image and stretches it over the frame with smoothing on, so light falls off
 * smoothly across a room but still stops at the walls the server's line of sight stopped at: a tile
 * the server did not light is never brightened here, only shaded.
 *
 * This replaces a vignette centred on the camera. That one ignored the lights entirely: it darkened
 * a lit torch pillar across the room as hard as the void beside it, drew the player's own pool of
 * light at a fixed radius whatever their torch actually reached, and stacked on top of remembered
 * geometry until that read as black.
 */

/** A light as the renderer sees it: where it is this frame and how far it reaches. */
export interface SceneLight {
  position: Vector2;
  radius: number;
}

/** Overlay alpha for space the viewer has never seen. Opaque, so it matches the cleared frame. */
export const UNSEEN_DARKNESS = 1;

/**
 * Overlay alpha for geometry the viewer remembers but cannot currently see. Dark enough to read as
 * out of the light, light enough that a party can still find its way back along a mapped corridor.
 */
export const REMEMBERED_DARKNESS = 0.8;

/**
 * Overlay alpha a lit tile reaches at the very edge of its light. Close to `REMEMBERED_DARKNESS`, so
 * the rim of a pool reads as dim rather than merely shaded, but still under it, so anything in view
 * is always brighter than anything remembered.
 */
export const LIT_EDGE_DARKNESS = 0.72;

/**
 * How the shade gathers from a light's centre to its rim: darkness is `LIT_EDGE_DARKNESS` times the
 * fraction of the radius reached, raised to this power. 2 keeps a broad bright middle; lower values
 * start dimming sooner, so only the core of a pool is bright and the outer half is plainly dim.
 */
export const LIGHT_FALLOFF_EXPONENT = 1.4;

/**
 * Darkness for a lit tile that no light in the snapshot accounts for, such as one lit by a source
 * whose own tile is out of view. Mid-range rather than bright, since the light is somewhere far off.
 */
const UNATTRIBUTED_DARKNESS = 0.5;

/** How dark a tile in view is, from the brightest light that reaches it. */
export function litDarkness(x: number, y: number, lights: readonly SceneLight[]): number {
  let darkest = Number.POSITIVE_INFINITY;

  for (const light of lights) {
    if (light.radius <= 0) continue;
    const reach = Math.hypot(x - light.position.x, y - light.position.y) / light.radius;
    if (reach >= 1) continue;
    darkest = Math.min(darkest, LIT_EDGE_DARKNESS * reach ** LIGHT_FALLOFF_EXPONENT);
  }

  return darkest === Number.POSITIVE_INFINITY ? UNATTRIBUTED_DARKNESS : darkest;
}

/**
 * Overlay alpha for one tile, from its snapshot character.
 *
 * `null` is a tile outside the window the snapshot carried, which is as unknown as a space.
 */
export function tileDarkness(
  tile: string | null,
  x: number,
  y: number,
  lights: readonly SceneLight[],
): number {
  if (tile === null || tile === UNKNOWN) return UNSEEN_DARKNESS;
  if (tile === KNOWN_FLOOR || tile === KNOWN_WALL) return REMEMBERED_DARKNESS;
  return litDarkness(x, y, lights);
}
