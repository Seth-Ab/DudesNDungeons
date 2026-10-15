import { describe, expect, it } from "vitest";
import { applyMapDiscovery } from "../../src/client/state/discoveredMap.js";
import { isTileLit, litTilesFrom } from "../../src/client/state/litTiles.js";
import type { MapDiscovery } from "../../src/shared/types/core.js";

function discovery(overrides: Partial<MapDiscovery> = {}): MapDiscovery {
  return {
    id: "w",
    name: "World",
    width: 5,
    height: 3,
    reset: true,
    discovered: [
      { x: 0, y: 0, tiles: "#####" },
      { x: 0, y: 1, tiles: "#...#" },
      { x: 0, y: 2, tiles: "#####" },
    ],
    lit: [],
    ...overrides,
  };
}

describe("the lit tile set", () => {
  it("lights exactly the tiles its runs cover", () => {
    const payload = discovery({ lit: [[1, 1, 2], [0, 0, 1]] });
    const map = applyMapDiscovery(null, payload);
    const lit = litTilesFrom(payload);

    const keys: string[] = [];
    for (let y = 0; y < 3; y += 1) {
      for (let x = 0; x < 5; x += 1) if (isTileLit(lit, map, x, y)) keys.push(`${x},${y}`);
    }
    expect(keys).toEqual(["0,0", "1,1", "2,1"]);
  });

  it("drops a run that falls off the world rather than wrapping it onto the next row", () => {
    const payload = discovery({ lit: [[4, 0, 3], [0, 3, 1], [2, 1, 1]] });
    const map = applyMapDiscovery(null, payload);
    const lit = litTilesFrom(payload);

    expect(isTileLit(lit, map, 4, 0)).toBe(false);
    expect(isTileLit(lit, map, 0, 1)).toBe(false);
    expect(isTileLit(lit, map, 0, 3)).toBe(false);
    expect(isTileLit(lit, map, 2, 1)).toBe(true);
  });

  it("lights nothing on a map of another world or size", () => {
    const lit = litTilesFrom(discovery({ lit: [[1, 1, 3]] }));
    const otherWorld = applyMapDiscovery(null, discovery({ id: "v" }));
    const otherSize = applyMapDiscovery(null, discovery({ width: 6 }));

    expect(isTileLit(lit, otherWorld, 1, 1)).toBe(false);
    expect(isTileLit(lit, otherSize, 1, 1)).toBe(false);
  });

  it("never lights a tile off the map", () => {
    const payload = discovery({ lit: [[0, 1, 5]] });
    const map = applyMapDiscovery(null, payload);
    const lit = litTilesFrom(payload);

    expect(isTileLit(lit, map, -1, 1)).toBe(false);
    expect(isTileLit(lit, map, 5, 1)).toBe(false);
  });
});
