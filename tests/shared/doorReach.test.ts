import { describe, expect, it } from "vitest";

import { INTERACT_RANGE, TILE_SCALE } from "../../src/shared/constants/game.js";
import { distanceToDoor } from "../../src/shared/game/movement.js";
import type { DoorState } from "../../src/shared/types/core.js";

/**
 * One authored doorway at world scale: a `TILE_SCALE` block centred half a tile in from its corner,
 * exactly as `scaleDungeon` places one. Spans world x and y 4 through 7.
 */
const door: DoorState = {
  id: "55555555-5555-4555-8555-555555555555",
  position: { x: 5.5, y: 5.5 },
  size: TILE_SCALE,
  open: false,
  locked: true,
};

describe("reaching a doorway", () => {
  it("measures to the face of the doorway, not to its centre", () => {
    // Standing one unit west of the opening's west face.
    expect(distanceToDoor({ x: 2.5, y: 5.5 }, door)).toBeCloseTo(1);
  });

  it("puts a player at the face within interact range", () => {
    // The whole point. The centre is two units further in, well past `INTERACT_RANGE`, so a client
    // measuring to it refused to send the interact that the server would have accepted, and no
    // locked door could be opened from the UI.
    const atTheFace = { x: 3.1, y: 5.5 };

    expect(distanceToDoor(atTheFace, door)).toBeLessThanOrEqual(INTERACT_RANGE);

    const toTheCentre = Math.hypot(atTheFace.x - door.position.x, atTheFace.y - door.position.y);
    expect(toTheCentre).toBeGreaterThan(INTERACT_RANGE);
  });

  it("is zero inside the doorway", () => {
    expect(distanceToDoor({ x: 5.5, y: 5.5 }, door)).toBe(0);
    expect(distanceToDoor({ x: 4, y: 7 }, door)).toBe(0);
  });

  it("measures to the nearest corner when a player stands off both axes", () => {
    expect(distanceToDoor({ x: 2.5, y: 2.5 }, door)).toBeCloseTo(Math.hypot(1, 1));
  });

  it("reaches a doorway from every side", () => {
    for (const from of [
      { x: 3.1, y: 5.5 },
      { x: 7.9, y: 5.5 },
      { x: 5.5, y: 3.1 },
      { x: 5.5, y: 7.9 },
    ]) {
      expect(distanceToDoor(from, door)).toBeLessThanOrEqual(INTERACT_RANGE);
    }
  });
});
