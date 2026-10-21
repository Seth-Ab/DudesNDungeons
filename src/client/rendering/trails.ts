import type { Vector2 } from "../../shared/types/core.js";
import { TRAIL_PALETTES, type TrailPalette, type TrailStyle } from "./characterPalettes.js";
import { CHARACTER_FRAME_WIDTH } from "./characters.js";

/**
 * Weapon trails (#138): the cosmetic arc and particles drawn over a player's swing, as squares of
 * art pixels in world units.
 *
 * Free of the DOM so it can be tested under node, like `lighting.ts`. A trail is decoration on the
 * server's swing, never a second opinion about it: every pixel this returns lies inside the reach
 * and arc the server resolved, so a cosmetic can never make a swing look longer or wider than the
 * hit it really was.
 */

/** One art pixel is a character pixel: a figure 16 pixels wide is one world unit across. */
export const TRAIL_PIXEL = 1 / CHARACTER_FRAME_WIDTH;

/** Where the trail's band starts, as a share of the reach. It runs from here out to the reach. */
export const TRAIL_INNER_RATIO = 0.55;

/** The geometry a trail draws on: a swing's resolved arc, and how far through its life it is. */
export interface TrailSwing {
  origin: Vector2;
  /** Direction of the arc's centre line, in radians. */
  heading: number;
  /** Half the arc's width, in radians. */
  halfArc: number;
  /** Reach in world units. */
  range: number;
  /** 0 when the swing starts, 1 when it is gone. */
  progress: number;
  /** Seeds the particles, so a swing's particles are the same on every frame of it. */
  seed: number;
}

/** One art pixel: its top-left corner in world units, a trail colour, and an opacity. */
export interface TrailPixel {
  x: number;
  y: number;
  colour: string;
  alpha: number;
}

/** The trail a player wears, or null for none or for an id the client has no art for. */
export function trailPalette(trailId: string | null): TrailPalette | null {
  if (trailId === null || !Object.hasOwn(TRAIL_PALETTES, trailId)) return null;
  return TRAIL_PALETTES[trailId as keyof typeof TRAIL_PALETTES];
}

/**
 * Whether a point is within a swing's reach and arc. The arc test is the server's: the cosine of
 * the angle off the swing's centre line, against the cosine of its half-width.
 */
function withinSwing(swing: TrailSwing, x: number, y: number): boolean {
  const dx = x - swing.origin.x;
  const dy = y - swing.origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance > swing.range) return false;
  if (distance === 0) return true;
  const along = (dx * Math.cos(swing.heading) + dy * Math.sin(swing.heading)) / distance;
  return along >= Math.cos(swing.halfArc);
}

/** Whether a whole art pixel, all four corners of it, is inside the swing. */
function pixelWithinSwing(swing: TrailSwing, x: number, y: number): boolean {
  return (
    withinSwing(swing, x, y) &&
    withinSwing(swing, x + TRAIL_PIXEL, y) &&
    withinSwing(swing, x, y + TRAIL_PIXEL) &&
    withinSwing(swing, x + TRAIL_PIXEL, y + TRAIL_PIXEL)
  );
}

/** How far the slash has swept across the arc, the same as the swing it is drawn on. */
function sweepOf(progress: number): number {
  return Math.min(1, progress * 2);
}

/** Opacity of the whole trail: full while sweeping, then fading out over the rest of the swing. */
function fadeOf(progress: number): number {
  return progress < 0.5 ? 1 : Math.max(0, 1 - (progress - 0.5) / 0.5);
}

/** A small seeded generator (mulberry32), so particles never depend on `Math.random`. */
function seededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let mixed = state;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

/** How many particles one swing leaves along its tip's path. */
const PARTICLES_PER_SWING = 8;

/** How long a particle lasts, as a share of the swing's life. Shards hang briefly and fade. */
const PARTICLE_LIFE: Record<Exclude<TrailStyle, "glint">, number> = {
  sparks: 0.8,
  shards: 0.45,
  wisps: 0.8,
  petals: 0.8,
};

/**
 * Where a particle has moved, in art pixels, `age` swing-lives after it left the tip: sparks pop up
 * and fall, shards hang where they were, wisps rise, and petals drift sideways as they sink.
 */
function particleDrift(style: Exclude<TrailStyle, "glint">, age: number, jitter: number): Vector2 {
  switch (style) {
    case "sparks":
      return { x: jitter * 2 * age, y: -3 * age + 14 * age * age };
    case "shards":
      return { x: 0, y: 0 };
    case "wisps":
      return { x: jitter * age, y: -7 * age };
    case "petals":
      return { x: 4 * age + Math.sin(age * 12 + jitter * 3), y: 3 * age };
  }
}

/** The art pixel a world point falls in, by its top-left corner on the swing's pixel grid. */
function snap(swing: TrailSwing, x: number, y: number): Vector2 {
  return {
    x: swing.origin.x + Math.floor((x - swing.origin.x) / TRAIL_PIXEL) * TRAIL_PIXEL,
    y: swing.origin.y + Math.floor((y - swing.origin.y) / TRAIL_PIXEL) * TRAIL_PIXEL,
  };
}

/**
 * Every art pixel of one swing's trail at its current progress.
 *
 * The arc is a band from `TRAIL_INNER_RATIO` of the reach out to the reach, swept from one edge of
 * the arc to the slash's leading edge, brightest at the outside and fading behind the edge. The
 * particles leave the tip as it passes and move by the trail's style; the glint is instead a
 * five-pixel star at the tip as the slash strikes. Anything that would land outside the swing's
 * reach or arc, a drifting particle included, is not drawn.
 */
export function trailPixels(swing: TrailSwing, palette: TrailPalette): TrailPixel[] {
  const fade = fadeOf(swing.progress);
  if (fade <= 0 || swing.range <= 0) return [];

  const sweep = sweepOf(swing.progress);
  const arcWidth = swing.halfArc * 2;
  const from = -swing.halfArc;
  const edge = from + arcWidth * sweep;
  const inner = swing.range * TRAIL_INNER_RATIO;
  const pixels = new Map<string, TrailPixel>();

  const put = (x: number, y: number, colour: string, alpha: number): void => {
    if (alpha <= 0 || !pixelWithinSwing(swing, x, y)) return;
    const key = `${Math.round((x - swing.origin.x) / TRAIL_PIXEL)},${Math.round((y - swing.origin.y) / TRAIL_PIXEL)}`;
    const drawn = pixels.get(key);
    if (!drawn || drawn.alpha < alpha) pixels.set(key, { x, y, colour, alpha: Math.min(1, alpha) });
  };

  // The band, cell by cell over the square that holds the reach.
  const cells = Math.ceil(swing.range / TRAIL_PIXEL);
  for (let row = -cells; row < cells; row += 1) {
    for (let column = -cells; column < cells; column += 1) {
      const x = swing.origin.x + column * TRAIL_PIXEL;
      const y = swing.origin.y + row * TRAIL_PIXEL;
      const dx = x + TRAIL_PIXEL / 2 - swing.origin.x;
      const dy = y + TRAIL_PIXEL / 2 - swing.origin.y;
      const distance = Math.hypot(dx, dy);
      if (distance < inner || distance > swing.range) continue;
      const turn = Math.atan2(dy, dx) - swing.heading;
      const offset = Math.atan2(Math.sin(turn), Math.cos(turn));
      if (offset < from || offset > edge) continue;

      const band = Math.min(3, Math.floor(((distance - inner) / (swing.range - inner)) * 4));
      const behind = arcWidth > 0 ? (edge - offset) / arcWidth : 0;
      // The inner edge is drawn fainter, so the band reads as a blade's path rather than a wedge.
      const alpha = (1 - 0.75 * behind) * fade * (band === 0 ? 0.5 : 1);
      put(x, y, palette.colours[band]!, alpha);
    }
  }

  // The tip sits a pixel and a half inside the reach, so what it leaves starts inside the swing.
  const tipRadius = Math.max(inner, swing.range - 1.5 * TRAIL_PIXEL);
  const tipAt = (offset: number): Vector2 => ({
    x: swing.origin.x + Math.cos(swing.heading + offset) * tipRadius,
    y: swing.origin.y + Math.sin(swing.heading + offset) * tipRadius,
  });

  if (palette.style === "glint") {
    // On the strike, far enough inside the reach and the leading edge that the star's arms fit.
    if (sweep >= 0.85 && swing.progress < 0.75) {
      const starRadius = Math.max(inner, swing.range - 3 * TRAIL_PIXEL);
      const margin = (3 * TRAIL_PIXEL) / starRadius;
      const turn = swing.heading + Math.max(from, edge - margin);
      const strike = {
        x: swing.origin.x + Math.cos(turn) * starRadius,
        y: swing.origin.y + Math.sin(turn) * starRadius,
      };
      const tip = snap(swing, strike.x, strike.y);
      const star = [[0, 0], [-1, 0], [1, 0], [0, -1], [0, 1]] as const;
      for (const [dx, dy] of star) put(tip.x + dx * TRAIL_PIXEL, tip.y + dy * TRAIL_PIXEL, palette.colours[3], fade);
    }
    return [...pixels.values()];
  }

  const random = seededRandom(swing.seed);
  const life = PARTICLE_LIFE[palette.style];
  for (let index = 0; index < PARTICLES_PER_SWING; index += 1) {
    const jitter = random() * 2 - 1;
    const colour = palette.colours[random() < 0.5 ? 2 : 3];
    // Each leaves the tip at an even point of the sweep, which takes the first half of the swing.
    const leftAt = ((index + 0.5) / PARTICLES_PER_SWING) * 0.5;
    const age = swing.progress - leftAt;
    if (age < 0 || age >= life) continue;
    const start = tipAt(from + arcWidth * sweepOf(leftAt));
    const drift = particleDrift(palette.style, age, jitter);
    const at = snap(swing, start.x + drift.x * TRAIL_PIXEL, start.y + drift.y * TRAIL_PIXEL);
    put(at.x, at.y, colour, 1 - age / life);
  }

  return [...pixels.values()];
}
