import { describe, expect, it } from "vitest";
import {
  litDarkness,
  REMEMBERED_DARKNESS,
  tileDarkness,
  UNSEEN_DARKNESS,
} from "../../src/client/rendering/lighting.js";

const torch = { position: { x: 0, y: 0 }, radius: 10 };

describe("tile darkness", () => {
  it("leaves unseen and off-window space fully dark", () => {
    expect(tileDarkness(" ", 0, 0, [torch])).toBe(UNSEEN_DARKNESS);
    expect(tileDarkness(null, 0, 0, [torch])).toBe(UNSEEN_DARKNESS);
  });

  it("shades remembered geometry flatly, whatever light is near it", () => {
    // The server decided it is out of sight; a light beside it on the client must not say otherwise.
    expect(tileDarkness(",", 0, 0, [torch])).toBe(REMEMBERED_DARKNESS);
    expect(tileDarkness("+", 0, 0, [torch])).toBe(REMEMBERED_DARKNESS);
  });

  it("always draws a lit tile brighter than a remembered one", () => {
    expect(tileDarkness(".", 9.99, 0, [torch])).toBeLessThan(REMEMBERED_DARKNESS);
    expect(tileDarkness("#", 9.99, 0, [torch])).toBeLessThan(REMEMBERED_DARKNESS);
  });
});

describe("lit darkness", () => {
  it("is brightest at the light and darkens toward its rim", () => {
    const near = litDarkness(1, 0, [torch]);
    const middle = litDarkness(5, 0, [torch]);
    const rim = litDarkness(9.9, 0, [torch]);

    expect(litDarkness(0, 0, [torch])).toBe(0);
    expect(near).toBeLessThan(middle);
    expect(middle).toBeLessThan(rim);
  });

  it("tapers into full darkness at its rim instead of stopping at a visible edge", () => {
    // The last stretch inside the rim changes by far less than the stretch before it, so there is
    // no seam where the lit pool meets the dark around it.
    const step = 0.5;
    const outer = litDarkness(9.99, 0, [torch]) - litDarkness(9.99 - step, 0, [torch]);
    const inner = litDarkness(7, 0, [torch]) - litDarkness(7 - step, 0, [torch]);

    expect(litDarkness(9.99, 0, [torch])).toBeGreaterThan(0.99);
    expect(outer).toBeLessThan(inner);
  });

  it("reads plainly dim across the outer part of a pool, not merely shaded", () => {
    // The outer quarter of a light sits nearer remembered darkness than full brightness.
    expect(litDarkness(7.5, 0, [torch])).toBeGreaterThan(REMEMBERED_DARKNESS / 2);
    expect(litDarkness(9.99, 0, [torch])).toBeGreaterThan(REMEMBERED_DARKNESS * 0.85);
  });

  it("takes the brightest of overlapping lights", () => {
    const pillar = { position: { x: 8, y: 0 }, radius: 4 };

    expect(litDarkness(8, 0, [torch, pillar])).toBe(0);
    expect(litDarkness(8, 0, [torch, pillar])).toBeLessThan(litDarkness(8, 0, [torch]));
  });

  it("draws a lit tile just past a light's rim as dark as the rim, not as unattributed", () => {
    // A wall bordering lit floor, or a tile the last snapshot lit before the torch moved on.
    expect(litDarkness(11, 0, [torch])).toBe(1);
    expect(litDarkness(10, 1, [torch])).toBe(1);
  });

  it("still lights a tile the server lit when no light in view accounts for it", () => {
    const value = litDarkness(50, 50, [torch]);

    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(REMEMBERED_DARKNESS);
  });
});
