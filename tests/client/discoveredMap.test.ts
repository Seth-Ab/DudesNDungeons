import { describe, expect, it } from "vitest";
import { applyMapDiscovery } from "../../src/client/state/discoveredMap.js";
import type { MapDiscovery } from "../../src/shared/types/core.js";

function discovery(overrides: Partial<MapDiscovery> = {}): MapDiscovery {
  return { id: "w", name: "World", width: 5, height: 3, reset: false, discovered: [], lit: [], ...overrides };
}

describe("applyMapDiscovery", () => {
  it("builds a baseline with undiscovered tiles blank", () => {
    const map = applyMapDiscovery(
      null,
      discovery({ reset: true, discovered: [{ x: 1, y: 1, tiles: "#." }] }),
    );

    expect(map).toMatchObject({ width: 5, height: 3, originX: 0, originY: 0 });
    expect(map.tiles).toEqual(["     ", " #.  ", "     "]);
  });

  it("adds new tiles to what is already known without disturbing it", () => {
    const first = applyMapDiscovery(null, discovery({ reset: true, discovered: [{ x: 0, y: 0, tiles: "##" }] }));
    const second = applyMapDiscovery(first, discovery({ discovered: [{ x: 3, y: 0, tiles: "." }, { x: 2, y: 2, tiles: "#" }] }));

    expect(second.tiles).toEqual(["## . ", "     ", "  #  "]);
    expect(first.tiles[0]).toBe("##   ");
  });

  it("returns the same map, and the same rows, when nothing was discovered", () => {
    const first = applyMapDiscovery(null, discovery({ reset: true, discovered: [{ x: 0, y: 0, tiles: "#" }] }));

    expect(applyMapDiscovery(first, discovery())).toBe(first);
  });

  it("shares untouched rows with the previous map", () => {
    const first = applyMapDiscovery(null, discovery({ reset: true, discovered: [{ x: 0, y: 0, tiles: "#" }] }));
    const second = applyMapDiscovery(first, discovery({ discovered: [{ x: 0, y: 2, tiles: "." }] }));

    expect(second.tiles).not.toBe(first.tiles);
    expect(second.tiles[0]).toBe(first.tiles[0]);
  });

  it("discards held geometry on a reset", () => {
    const first = applyMapDiscovery(null, discovery({ reset: true, discovered: [{ x: 0, y: 0, tiles: "#####" }] }));
    const second = applyMapDiscovery(first, discovery({ reset: true, discovered: [{ x: 0, y: 1, tiles: "." }] }));

    expect(second.tiles).toEqual(["     ", ".    ", "     "]);
  });

  it("starts afresh for another world even without a reset", () => {
    const first = applyMapDiscovery(null, discovery({ reset: true, discovered: [{ x: 0, y: 0, tiles: "#####" }] }));
    const second = applyMapDiscovery(first, discovery({ id: "other", width: 2, height: 2, discovered: [{ x: 0, y: 0, tiles: "." }] }));

    expect(second.tiles).toEqual([".  ".slice(0, 2), "  "]);
  });

  it("ignores a run that would spill past the world", () => {
    const map = applyMapDiscovery(null, discovery({ reset: true, discovered: [{ x: 4, y: 0, tiles: "##" }, { x: 0, y: 9, tiles: "#" }] }));

    expect(map.tiles).toEqual(["     ", "     ", "     "]);
  });

  it("carries the theme and accumulates props as they are discovered", () => {
    const fountain = { kind: "fountain", x: 0, y: 0 } as const;
    const tree = { kind: "tree", x: 4, y: 0 } as const;
    const first = applyMapDiscovery(
      null,
      discovery({ reset: true, theme: "forest", discovered: [{ x: 0, y: 0, tiles: "#" }], props: [fountain] }),
    );
    const second = applyMapDiscovery(first, discovery({ theme: "forest", props: [tree] }));

    expect(first).toMatchObject({ theme: "forest", props: [fountain] });
    expect(second).not.toBe(first);
    expect(second.props).toEqual([fountain, tree]);
    expect(second.tiles).toEqual(first.tiles);
    expect(applyMapDiscovery(second, discovery({ theme: "forest" }))).toBe(second);
  });

  it("accumulates seats as they are discovered and drops them on a reset", () => {
    const bench = { id: "14f4b265-75ae-41f0-81ba-f62410dcc5b3", x: 1, y: 0.75, facing: "south" } as const;
    const rim = { id: "32924e4e-473a-4c26-b13a-4f8ba4376dfb", x: 3, y: 1.25, facing: "north" } as const;
    const first = applyMapDiscovery(null, discovery({ reset: true, seats: [bench] }));
    const second = applyMapDiscovery(first, discovery({ seats: [rim] }));

    expect(first.seats).toEqual([bench]);
    expect(second).not.toBe(first);
    expect(second.seats).toEqual([bench, rim]);
    expect(applyMapDiscovery(second, discovery({}))).toBe(second);
    expect(applyMapDiscovery(second, discovery({ reset: true })).seats).toEqual([]);
  });

  it("accumulates ready plates as they are discovered and drops them on a reset", () => {
    const west = { id: "d855ab91-8776-4acc-8e83-cfcc03fb0e5a", x: 1, y: 1 };
    const east = { id: "48eac2e5-7e3c-4fec-81b1-c86c09a0be79", x: 3, y: 1 };
    const first = applyMapDiscovery(null, discovery({ reset: true, readyPlates: [west] }));
    const second = applyMapDiscovery(first, discovery({ readyPlates: [east] }));

    expect(first.readyPlates).toEqual([west]);
    expect(second).not.toBe(first);
    expect(second.readyPlates).toEqual([west, east]);
    expect(applyMapDiscovery(second, discovery({}))).toBe(second);
    expect(applyMapDiscovery(second, discovery({ reset: true })).readyPlates).toBeUndefined();
  });

  it("drops held props on a reset, keeping only what the baseline carries", () => {
    const first = applyMapDiscovery(null, discovery({ reset: true, props: [{ kind: "bush", x: 1, y: 1 }] }));
    const rebased = applyMapDiscovery(first, discovery({ reset: true }));

    expect(rebased.props).toEqual([]);
    expect(rebased.theme).toBeUndefined();
  });
});

describe("applyMapDiscovery with a ground grid", () => {
  it("holds no ground for a map whose runs carry none", () => {
    const map = applyMapDiscovery(null, discovery({ reset: true, discovered: [{ x: 1, y: 1, tiles: "#." }] }));

    expect(map.ground).toBeUndefined();
  });

  it("lays ground alongside the tiles it arrives with, blank where nothing is known", () => {
    const map = applyMapDiscovery(
      null,
      discovery({ reset: true, discovered: [{ x: 1, y: 1, tiles: "...", ground: "gcd" }] }),
    );

    expect(map.tiles).toEqual(["     ", " ... ", "     "]);
    expect(map.ground).toEqual(["     ", " gcd ", "     "]);
  });

  it("fills theme floor for tiles known before the first ground, and for runs that carry none", () => {
    const first = applyMapDiscovery(null, discovery({ reset: true, discovered: [{ x: 0, y: 0, tiles: ".." }] }));
    const second = applyMapDiscovery(
      first,
      discovery({ discovered: [{ x: 0, y: 2, tiles: "..", ground: "cg" }, { x: 3, y: 2, tiles: "#." }] }),
    );

    expect(second.ground).toEqual(["..   ", "     ", "cg .."]);
    expect(first.ground).toBeUndefined();
  });

  it("keeps ground it already holds across deltas, and drops it on a reset", () => {
    const first = applyMapDiscovery(
      null,
      discovery({ reset: true, discovered: [{ x: 0, y: 0, tiles: "..", ground: "gg" }] }),
    );
    const second = applyMapDiscovery(first, discovery({ discovered: [{ x: 4, y: 1, tiles: ".", ground: "d" }] }));
    const rebased = applyMapDiscovery(second, discovery({ reset: true, discovered: [{ x: 0, y: 0, tiles: "." }] }));

    expect(second.ground).toEqual(["gg   ", "    d", "     "]);
    expect(rebased.ground).toBeUndefined();
  });
});
