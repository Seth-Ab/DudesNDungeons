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
 * Overlay alpha for geometry the viewer remembers but cannot currently see. Fully dark: once a light
 * moves on, what it showed goes back to black, so the party has to remember its own way.
 */
export const REMEMBERED_DARKNESS = 1;

/**
 * How a light tapers from its centre to its rim: brightness is `(1 - reach²)` raised to this power,
 * where `reach` is the fraction of the radius. It reaches full darkness exactly at the rim with no
 * slope left, so a pool fades into the surrounding black instead of ending at a visible edge. Higher
 * values pull the fade inward toward the light; lower values keep the middle bright for longer.
 */
export const LIGHT_TAPER_EXPONENT = 1.5;

/**
 * Darkness for a lit tile that no light in the snapshot accounts for, such as one lit by a source
 * whose own tile is out of view. Mid-range rather than bright, since the light is somewhere far off.
 */
const UNATTRIBUTED_DARKNESS = 0.5;

/**
 * How far past a light's rim, in world tiles, a lit tile still counts as that light's and is drawn at
 * the rim's full darkness rather than as unattributed.
 *
 * The server lights more than the radius: every wall bordering a lit floor tile, up to about 1.4
 * tiles beyond it. A carried torch also draws at the predicted local position while the lit tiles
 * arrive with the last snapshot, so the rim the server lit trails the one drawn here. Without this
 * slack, both kinds of tile fell back to `UNATTRIBUTED_DARKNESS` and glowed just outside a pool that
 * had already faded to black, flickering at the snapshot rate as the player moved.
 */
const RIM_SLACK_TILES = 3;

/** How dark a tile in view is, from the brightest light that reaches it. */
export function litDarkness(x: number, y: number, lights: readonly SceneLight[]): number {
  let darkest = Number.POSITIVE_INFINITY;

  for (const light of lights) {
    if (light.radius <= 0) continue;
    const distance = Math.hypot(x - light.position.x, y - light.position.y);
    if (distance >= light.radius + RIM_SLACK_TILES) continue;
    const reach = Math.min(distance / light.radius, 1);
    darkest = Math.min(darkest, 1 - (1 - reach * reach) ** LIGHT_TAPER_EXPONENT);
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
