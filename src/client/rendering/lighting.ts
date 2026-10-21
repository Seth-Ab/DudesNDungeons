import type { LightSourceState, Vector2 } from "../../shared/types/core.js";
import { KNOWN_FLOOR, KNOWN_WALL, LIT_WALL, UNKNOWN } from "./tiles.js";

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

/** Someone a carried torch can follow: its light shares their id. */
export interface LightBearer {
  id: string;
  /** Where they are drawn this frame, which is where their torch is. */
  position: Vector2;
}

/**
 * Where each light in the snapshot stands this frame, and how far it reaches: the lightmap's whole
 * input. Nothing about how a light is drawn, a cosmetic flame included, can reach it.
 *
 * A carried torch follows its bearer as drawn, not as last sent: the local player is drawn at
 * the predicted position and remote players are interpolated, so a torch pinned to the snapshot
 * position would leave the pool of light trailing a step behind whoever carries it.
 */
export function sceneLights(
  lights: readonly LightSourceState[],
  self: LightBearer | null,
  others: readonly LightBearer[],
  now: number,
): SceneLight[] {
  return lights.map((light) => {
    if (light.kind !== "carriedTorch") {
      return { position: light.position, radius: light.radius * flickerFactor(light.id, now, light.flicker ?? 0) };
    }
    if (self && light.id === self.id) return { position: self.position, radius: light.radius };
    const bearer = others.find((player) => player.id === light.id);
    return { position: bearer ? bearer.position : light.position, radius: light.radius };
  });
}

/**
 * How much of its reach a flickering light keeps, from `1 - flicker` to 1, at a wall-clock time.
 *
 * A pure function of the time and the light's id, so every client shows the same flame at the same
 * moment and no two lights share a phase. Two sines at unrelated rates make the waver irregular
 * enough to read as fire rather than a pulse; each rate and phase comes from a hash of the id.
 */
export function flickerFactor(lightId: string, timeMs: number, flicker: number): number {
  if (flicker <= 0) return 1;

  const hash = hashString(lightId);
  const slow = Math.sin(timeMs / 1000 * (3.1 + (hash % 17) / 10) + (hash % 628) / 100);
  const fast = Math.sin(timeMs / 1000 * (8.3 + ((hash >>> 8) % 23) / 10) + ((hash >>> 12) % 628) / 100);
  const wave = (slow * 0.65 + fast * 0.35 + 1) / 2;

  return 1 - flicker * (1 - wave);
}

/** 32-bit FNV-1a, so the same id gives the same number on every client. */
function hashString(text: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/**
 * The hub's light floor: how dark a lit tile is before any light reaches it, as an alpha for the
 * near-black overlay. 0.3 leaves about 70% of the tile's brightness, so nothing in the plaza reads
 * as black while a lantern's pool is still visibly brighter. The one number to tune.
 */
export const HUB_AMBIENT_DARKNESS = 0.3;

/** How much darker the very edge of the hub is than its plaza, added to the floor above. */
export const HUB_EDGE_DARKNESS = 0.3;

/** How far in from the map's edge, in world tiles, the forest-edge vignette reaches. */
export const HUB_VIGNETTE_TILES = 16;

/**
 * Darkness of a hub tile with no light on it: the ambient floor, deepening toward the forest at the
 * map's edge. Never reaches full darkness, so no tile of the hub can read as black.
 */
export function hubAmbientDarkness(x: number, y: number, width: number, height: number): number {
  const edge = Math.min(x, y, width - 1 - x, height - 1 - y);
  const depth = Math.max(0, Math.min(1, 1 - edge / HUB_VIGNETTE_TILES));

  return HUB_AMBIENT_DARKNESS + HUB_EDGE_DARKNESS * depth * depth;
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
 * How dark one light leaves a tile, or null when the tile is past its rim. Shared by the per-tile
 * and the whole-frame paths below so the two cannot disagree.
 *
 * A tile the server lit that no light in the snapshot reaches draws fully dark, the same as
 * remembered geometry. The server lights a little past each radius (every wall bordering lit floor),
 * and a carried torch draws at the predicted position while the lit set trails a snapshot behind, but
 * the taper is already black at the rim, so neither may glow. A light the viewer can see always has
 * its own tile lit and so is always in the snapshot, which leaves nothing that should glow unexplained.
 */
function lightDarkness(distance: number, radius: number): number | null {
  if (distance >= radius) return null;
  const reach = distance / radius;
  return 1 - (1 - reach * reach) ** LIGHT_TAPER_EXPONENT;
}

/** How dark a tile in view is, from the brightest light that reaches it. */
export function litDarkness(x: number, y: number, lights: readonly SceneLight[]): number {
  let darkest = Number.POSITIVE_INFINITY;

  for (const light of lights) {
    if (light.radius <= 0) continue;
    const darkness = lightDarkness(Math.hypot(x - light.position.x, y - light.position.y), light.radius);
    if (darkness !== null) darkest = Math.min(darkest, darkness);
  }

  return darkest === Number.POSITIVE_INFINITY ? REMEMBERED_DARKNESS : darkest;
}

/**
 * The character the shader should read for a discovered tile, given whether the server lit it this
 * snapshot. The client's map holds only `#` and `.`, so lit versus remembered is put back here from
 * the snapshot's lit set: an unlit tile reads as its remembered form and shades fully dark, however
 * close a light on screen stands to it. That is what keeps a torch from glowing through a wall onto
 * the room behind it, or across geometry an ally shared.
 */
export function shadingTile(tile: string | null, lit: boolean): string | null {
  if (lit || tile === null || tile === UNKNOWN) return tile;
  return tile === LIT_WALL || tile === KNOWN_WALL ? KNOWN_WALL : KNOWN_FLOOR;
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

/**
 * Shades a whole block of tiles at once, writing each tile's overlay alpha (0 to 255) into the
 * alpha channel of an RGBA buffer.
 *
 * The result is the same as `tileDarkness` for every tile, but gets there light by light rather than
 * tile by tile. A frame is a couple of thousand tiles and a party carries a handful of lights, and
 * most lights reach only a small part of the screen, so visiting just the tiles inside each light's
 * reach does a fraction of the work of asking every light about every tile. The scratch buffers
 * persist between calls, so a frame allocates nothing once the screen size settles.
 *
 * `ambient`, when given, is the darkness of a lit tile no light reaches. The hub passes one; a
 * dungeon does not, and leaves unlit-but-visible tiles fully dark.
 */
export function createLightShader() {
  let lit = new Uint8Array(0);
  let level = new Float32Array(0);

  return function shade(
    rgba: Uint8ClampedArray,
    columns: number,
    rows: number,
    minX: number,
    minY: number,
    readTile: (x: number, y: number) => string | null,
    lights: readonly SceneLight[],
    ambient?: (x: number, y: number) => number,
  ): void {
    const count = columns * rows;
    if (lit.length < count) {
      lit = new Uint8Array(count);
      level = new Float32Array(count);
    }

    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        const index = row * columns + column;
        const tile = readTile(minX + column, minY + row);
        if (tile === null || tile === UNKNOWN) {
          lit[index] = 0;
          level[index] = UNSEEN_DARKNESS;
        } else if (tile === KNOWN_FLOOR || tile === KNOWN_WALL) {
          lit[index] = 0;
          level[index] = REMEMBERED_DARKNESS;
        } else {
          lit[index] = 1;
          // A lit tile with no ambient floor is dark until a light says otherwise.
          level[index] = ambient ? ambient(minX + column, minY + row) : Number.POSITIVE_INFINITY;
        }
      }
    }

    for (const light of lights) {
      if (light.radius <= 0) continue;

      const reach = light.radius;
      const firstColumn = Math.max(0, Math.floor(light.position.x - reach) - minX);
      const lastColumn = Math.min(columns - 1, Math.ceil(light.position.x + reach) - minX);
      const firstRow = Math.max(0, Math.floor(light.position.y - reach) - minY);
      const lastRow = Math.min(rows - 1, Math.ceil(light.position.y + reach) - minY);

      for (let row = firstRow; row <= lastRow; row += 1) {
        for (let column = firstColumn; column <= lastColumn; column += 1) {
          const index = row * columns + column;
          if (lit[index] === 0) continue;

          const darkness = lightDarkness(
            Math.hypot(minX + column - light.position.x, minY + row - light.position.y),
            light.radius,
          );
          if (darkness !== null && darkness < level[index]!) level[index] = darkness;
        }
      }
    }

    for (let index = 0; index < count; index += 1) {
      const darkness = level[index]!;
      rgba[index * 4 + 3] = Math.round(
        (darkness === Number.POSITIVE_INFINITY ? REMEMBERED_DARKNESS : darkness) * 255,
      );
    }
  };
}
