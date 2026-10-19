import { describe, expect, it } from "vitest";
import { TRAINING_DUMMY_WINDOW_MS } from "../../src/shared/constants/game.js";
import {
  createDummyWobbles,
  dummyPlate,
  WOBBLE_LIFETIME_MS,
  wobbleAngle,
} from "../../src/client/state/trainingDummies.js";
import type { DummyState } from "../../src/shared/types/core.js";

const DUMMY = "c3333333-3333-4333-8333-333333333333";
const SELF = "8f1d6b0e-6a4a-4f2e-9d1c-2b3a4c5d6e7f";
const ALLY = "9a2e7c1f-7b5b-4a3f-8e2d-3c4b5d6e7f80";

function dummy(overrides: Partial<DummyState> = {}): DummyState {
  return { id: DUMMY, position: { x: 1, y: 1 }, recentDamage: 0, dps: 0, attackers: [], ...overrides };
}

describe("dummyPlate", () => {
  it("shows nothing while nobody has hit the dummy in the window", () => {
    expect(dummyPlate(dummy(), TRAINING_DUMMY_WINDOW_MS)).toBeNull();
  });

  it("formats the server's readout without recomputing it", () => {
    const struck = dummy({
      recentDamage: 18,
      dps: 7.2,
      attackers: [{ playerId: SELF, recentDamage: 18, dps: 7.2 }],
    });

    expect(dummyPlate(struck, TRAINING_DUMMY_WINDOW_MS)).toEqual({
      dps: "7.2 DPS",
      detail: "18 dmg in 5s",
    });
  });

  it("says how many are hitting when more than one is", () => {
    const shared = dummy({
      recentDamage: 30,
      dps: 12,
      attackers: [
        { playerId: SELF, recentDamage: 18, dps: 7 },
        { playerId: ALLY, recentDamage: 12, dps: 5 },
      ],
    });

    expect(dummyPlate(shared, TRAINING_DUMMY_WINDOW_MS)).toEqual({
      dps: "12.0 DPS",
      detail: "30 dmg in 5s · 2 hitting",
    });
  });
});

describe("dummy wobble", () => {
  it("sways after a hit and settles once its lifetime ends", () => {
    expect(wobbleAngle(0)).toBe(0);
    expect(Math.abs(wobbleAngle(WOBBLE_LIFETIME_MS / 12))).toBeGreaterThan(0.1);
    expect(wobbleAngle(WOBBLE_LIFETIME_MS)).toBe(0);
    expect(wobbleAngle(-1)).toBe(0);
  });

  it("tracks each struck dummy until it is at rest", () => {
    const wobbles = createDummyWobbles();
    wobbles.hit(DUMMY, 1000);

    expect(wobbles.angles(1000 + WOBBLE_LIFETIME_MS / 12).has(DUMMY)).toBe(true);
    expect(wobbles.angles(1000 + WOBBLE_LIFETIME_MS).has(DUMMY)).toBe(false);

    wobbles.hit(DUMMY, 5000);
    wobbles.clear();
    expect(wobbles.angles(5001).size).toBe(0);
  });
});
