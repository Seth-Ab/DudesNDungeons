import { describe, expect, it } from "vitest";
import {
  MAX_PREDICTION_ERROR,
  PREDICTION_SETTLE_MS,
  headingFrom,
  predictMove,
  reconcile,
} from "../../src/client/state/gameState.js";
import { PLAYER_STEP_DISTANCE } from "../../src/shared/game/movement.js";
import type { DungeonState, PlayerState } from "../../src/shared/types/core.js";

function dungeon(overrides: Partial<DungeonState> = {}): DungeonState {
  return {
    map: {
      id: "test",
      name: "Test",
      width: 6,
      height: 4,
      tiles: ["######", "#....#", "#....#", "######"],
    },
    monsters: [],
    loot: [],
    doors: [],
    exits: [],
    lightSources: [],
    cleared: false,
    ...overrides,
  };
}

function other(position: { x: number; y: number }, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: "00000000-0000-4000-8000-000000000000",
    name: "Other",
    position,
    facing: { x: 0, y: 1 },
    health: 100,
    ready: false,
    connected: true,
    inventory: [],
    ...overrides,
  };
}

describe("headingFrom", () => {
  it("returns null when nothing is held", () => {
    expect(headingFrom([])).toBeNull();
  });

  it("sums held keys into a diagonal", () => {
    expect(headingFrom(["north", "east"])).toEqual({ x: 1, y: -1 });
  });

  it("returns null when opposite keys cancel", () => {
    expect(headingFrom(["east", "west"])).toBeNull();
  });
});

describe("predictMove", () => {
  it("steps by the server's distance, not a whole tile", () => {
    expect(predictMove(dungeon(), [], { x: 2, y: 1.5 }, { x: 1, y: 0 })).toEqual({
      x: 2 + PLAYER_STEP_DISTANCE,
      y: 1.5,
    });
  });

  // Regression: whole-tile prediction indexed tiles by fractional positions and froze once the
  // server moved the player off a tile boundary.
  it("keeps predicting from a fractional position", () => {
    const from = { x: 2.125, y: 1.375 };

    expect(predictMove(dungeon(), [], from, { x: 0, y: 1 }).y).toBeCloseTo(
      1.375 + PLAYER_STEP_DISTANCE,
    );
  });

  // Integer positions are tile centers, so the wall tile at x = 0 starts at x = 0.5.
  it("stays put against a wall", () => {
    const from = { x: 0.6, y: 1 };

    expect(predictMove(dungeon(), [], from, { x: -1, y: 0 })).toBe(from);
  });

  it("stays put against another player or a living monster, but walks past a dead one", () => {
    const from = { x: 2, y: 1.5 };
    const ahead = { x: 2.6, y: 1.5 };

    expect(predictMove(dungeon(), [other(ahead)], from, { x: 1, y: 0 })).toBe(from);

    const monster = {
      id: "11111111-1111-4111-8111-111111111111",
      name: "Imp",
      health: 5,
      maxHealth: 5,
    };
    const living = dungeon({ monsters: [{ ...monster, position: ahead, alive: true }] });
    const dead = dungeon({ monsters: [{ ...monster, position: ahead, alive: false }] });

    expect(predictMove(living, [], from, { x: 1, y: 0 })).toBe(from);
    expect(predictMove(dead, [], from, { x: 1, y: 0 })).not.toBe(from);
  });

  it("walks through a downed player, as the server allows", () => {
    const from = { x: 2, y: 1.5 };

    expect(
      predictMove(dungeon(), [other({ x: 2.6, y: 1.5 }, { health: 0 })], from, { x: 1, y: 0 }),
    ).not.toBe(from);
  });

  it("ignores a zero heading", () => {
    const from = { x: 2, y: 1.5 };

    expect(predictMove(dungeon(), [], from, { x: 0, y: 0 })).toBe(from);
  });
});

describe("reconcile", () => {
  const predicted = { x: 3, y: 2 };

  it("adopts the server position once in-flight moves have settled", () => {
    expect(reconcile(predicted, { x: 2.75, y: 2 }, PREDICTION_SETTLE_MS)).toEqual({ x: 2.75, y: 2 });
  });

  it("keeps a prediction that is only ahead of the server while moving", () => {
    expect(reconcile(predicted, { x: 2.75, y: 2 }, 0)).toBe(predicted);
  });

  it("snaps back when the prediction has drifted too far", () => {
    const server = { x: 3 - MAX_PREDICTION_ERROR - 0.1, y: 2 };

    expect(reconcile(predicted, server, 0)).toEqual(server);
  });
});
