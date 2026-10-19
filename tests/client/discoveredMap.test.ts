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

  it("drops held props on a reset, keeping only what the baseline carries", () => {
    const first = applyMapDiscovery(null, discovery({ reset: true, props: [{ kind: "bush", x: 1, y: 1 }] }));
    const rebased = applyMapDiscovery(first, discovery({ reset: true }));

    expect(rebased.props).toEqual([]);
    expect(rebased.theme).toBeUndefined();
  });
});
