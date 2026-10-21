import { describe, expect, it } from "vitest";
import { TRAIL_PALETTES } from "../../src/client/rendering/characterPalettes.js";
import {
  TRAIL_INNER_RATIO,
  TRAIL_PIXEL,
  trailPalette,
  trailPixels,
  type TrailSwing,
} from "../../src/client/rendering/trails.js";

/** A swing as the protocol sends it: facing as a vector and the arc as a cosine. */
interface ServerSwing {
  origin: { x: number; y: number };
  facing: { x: number; y: number };
  range: number;
  arcCos: number;
}

/** Drawn as the client does: `swingArc` turns the protocol's geometry into a heading and half-arc. */
function trailSwing(swing: ServerSwing, progress: number, seed = 7): TrailSwing {
  return {
    origin: swing.origin,
    heading: Math.atan2(swing.facing.y, swing.facing.x),
    halfArc: Math.acos(swing.arcCos),
    range: swing.range,
    progress,
    seed,
  };
}

/** Whether a point is within the server's swing: inside its range, and its arc by the cosine test. */
function insideServerSwing(swing: ServerSwing, x: number, y: number): boolean {
  const dx = x - swing.origin.x;
  const dy = y - swing.origin.y;
  const distance = Math.hypot(dx, dy);
  if (distance > swing.range + 1e-9) return false;
  if (distance === 0) return true;
  const length = Math.hypot(swing.facing.x, swing.facing.y);
  const along = (dx * swing.facing.x + dy * swing.facing.y) / (distance * length);
  return along >= swing.arcCos - 1e-9;
}

const PROGRESSES = [0, 0.05, 0.1, 0.2, 0.3, 0.45, 0.5, 0.6, 0.75, 0.9, 0.99];

/** Deterministic, so a failure names a swing that can be replayed. */
function swings(): ServerSwing[] {
  let state = 12345;
  const random = (): number => {
    state = (Math.imul(state, 1103515245) + 12345) >>> 0;
    return state / 4294967296;
  };
  const out: ServerSwing[] = [
    // The sword's reach and arc, facing each way, and an unarmed jab.
    { origin: { x: 10.3, y: 20.7 }, facing: { x: 1, y: 0 }, range: 1.6, arcCos: 0.5 },
    { origin: { x: 4, y: 4 }, facing: { x: 0, y: -1 }, range: 1.6, arcCos: 0.5 },
    { origin: { x: 4.49, y: 4.51 }, facing: { x: -0.7071, y: 0.7071 }, range: 1.1, arcCos: 0.7 },
    { origin: { x: 0, y: 0 }, facing: { x: 0, y: 1 }, range: 0.9, arcCos: 0.9 },
    // A wide arc past a right angle, where the sector is no longer convex.
    { origin: { x: 2.2, y: 3.3 }, facing: { x: -1, y: 0 }, range: 2, arcCos: -0.3 },
  ];
  for (let index = 0; index < 15; index += 1) {
    const angle = random() * Math.PI * 2;
    out.push({
      origin: { x: random() * 50, y: random() * 50 },
      facing: { x: Math.cos(angle) * (0.5 + random()), y: Math.sin(angle) * (0.5 + random()) },
      range: 0.5 + random() * 2.5,
      arcCos: random() * 1.8 - 0.9,
    });
  }
  return out;
}

describe("weapon trail geometry", () => {
  it("never draws a pixel beyond the swing's range or outside its arc", () => {
    let drawn = 0;
    const outside: string[] = [];
    for (const id of Object.keys(TRAIL_PALETTES)) {
      const palette = trailPalette(id)!;
      for (const swing of swings()) {
        for (const progress of PROGRESSES) {
          for (const pixel of trailPixels(trailSwing(swing, progress), palette)) {
            drawn += 1;
            const corners = [
              [pixel.x, pixel.y],
              [pixel.x + TRAIL_PIXEL, pixel.y],
              [pixel.x, pixel.y + TRAIL_PIXEL],
              [pixel.x + TRAIL_PIXEL, pixel.y + TRAIL_PIXEL],
            ] as const;
            if (!corners.every(([x, y]) => insideServerSwing(swing, x, y))) {
              outside.push(`${id} at ${progress}: ${JSON.stringify(swing)}`);
            }
          }
        }
      }
    }
    expect(outside).toEqual([]);
    // Not vacuous: the trails really drew.
    expect(drawn).toBeGreaterThan(10_000);
  }, 30_000);

  it("draws the arc as a band from just over half the reach out to the reach", () => {
    const swing: ServerSwing = { origin: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, range: 2, arcCos: 0.5 };
    const pixels = trailPixels(trailSwing(swing, 0.5), trailPalette("ember-sparks")!);
    const centres = pixels.map((pixel) => Math.hypot(pixel.x + TRAIL_PIXEL / 2, pixel.y + TRAIL_PIXEL / 2));
    expect(Math.min(...centres)).toBeGreaterThanOrEqual(2 * TRAIL_INNER_RATIO - TRAIL_PIXEL);
    expect(Math.max(...centres)).toBeGreaterThan(2 - 2 * TRAIL_PIXEL);
    // The outer edge wears the brightest colour, the inner the darkest.
    const outer = pixels.find((pixel) => Math.hypot(pixel.x, pixel.y) > 1.9);
    expect(outer?.colour).toBe(TRAIL_PALETTES["ember-sparks"].colours[3]);
  });

  it("sweeps with the slash and fades out by the end of the swing", () => {
    const swing: ServerSwing = { origin: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, range: 2, arcCos: 0.5 };
    const palette = trailPalette("frost-shards")!;
    const early = trailPixels(trailSwing(swing, 0.1), palette);
    const full = trailPixels(trailSwing(swing, 0.5), palette);
    expect(early.length).toBeGreaterThan(0);
    expect(full.length).toBeGreaterThan(early.length);
    // Early on, only the arc's starting side is drawn: above the centre line, since y grows down.
    expect(early.every((pixel) => pixel.y + TRAIL_PIXEL / 2 < 0.5)).toBe(true);
    expect(trailPixels(trailSwing(swing, 1), palette)).toEqual([]);
  });

  it("draws the same particles on every frame of one swing", () => {
    const swing: ServerSwing = { origin: { x: 3, y: 3 }, facing: { x: 0, y: 1 }, range: 1.6, arcCos: 0.5 };
    const palette = trailPalette("petal-drift")!;
    expect(trailPixels(trailSwing(swing, 0.4, 99), palette)).toEqual(trailPixels(trailSwing(swing, 0.4, 99), palette));
  });

  it("strikes a five-pixel star at the tip for the glint, and only near the end of the sweep", () => {
    const swing: ServerSwing = { origin: { x: 0, y: 0 }, facing: { x: 1, y: 0 }, range: 2, arcCos: 0.5 };
    const palette = trailPalette("gilded-glint")!;
    const star = (progress: number) =>
      trailPixels(trailSwing(swing, progress), palette).filter(
        (pixel) => pixel.colour === palette.colours[3] && pixel.alpha === 1 && Math.hypot(pixel.x, pixel.y) > 1.5,
      );
    expect(star(0.2).length).toBe(0);
    expect(star(0.5).length).toBeGreaterThanOrEqual(5);
  });

  it("draws nothing for no trail or one the client has no art for", () => {
    expect(trailPalette(null)).toBeNull();
    expect(trailPalette("rainbow-trail")).toBeNull();
    expect(trailPalette("toString")).toBeNull();
  });
});
