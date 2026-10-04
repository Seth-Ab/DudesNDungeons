import { describe, expect, it } from "vitest";
import {
  LIT_EDGE_DARKNESS,
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
    expect(rim).toBeLessThanOrEqual(LIT_EDGE_DARKNESS);
  });

  it("takes the brightest of overlapping lights", () => {
    const pillar = { position: { x: 8, y: 0 }, radius: 4 };

    expect(litDarkness(8, 0, [torch, pillar])).toBe(0);
    expect(litDarkness(8, 0, [torch, pillar])).toBeLessThan(litDarkness(8, 0, [torch]));
  });

  it("still lights a tile the server lit when no light in view accounts for it", () => {
    const value = litDarkness(50, 50, [torch]);

    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThan(REMEMBERED_DARKNESS);
  });
});
