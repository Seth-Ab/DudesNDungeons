import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import {
  MAX_PREDICTION_ERROR,
  PREDICTION_SETTLE_MS,
  headingFrom,
  predictMove,
  reconcile,
  stepsIntoUndiscovered,
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
      originX: 0,
      originY: 0,
      tiles: ["######", "#....#", "#....#", "######"],
    },
    rooms: [],
    monsters: [],
    projectiles: [],
    loot: [],
    chests: [],
    traps: [],
    puzzles: [],
    doors: [],
    exits: [],
    lightSources: [],
    dummies: [],
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
    resistance: 40,
    stamina: 100,
    ready: false,
    connected: true,
    inventory: [],
    held: null,
    drawFraction: null,
    carryingTorch: false,
    carryingPlayerId: null,
    carriedByPlayerId: null,
    seatId: null,
    readyPlateId: null,
    appearance: { ...DEFAULT_APPEARANCE },
    partyColor: "ember",
    cosmetics: { hat: null, cloak: null, dye: null, trail: null, flame: null },
    bankedItems: [],
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

  // Regression: remembered floor arrives as `,`, and prediction treated it as wall, freezing the
  // player at the edge of the light until reconciliation snapped them forward.
  it("predicts a step onto floor the viewer remembers but cannot see", () => {
    const dim = dungeon();
    dim.map = { ...dim.map, tiles: ["######", "#..,,#", "#..,,#", "######"] };

    expect(predictMove(dim, [], { x: 2.45, y: 1.5 }, { x: 1, y: 0 })).toEqual({
      x: 2.45 + PLAYER_STEP_DISTANCE,
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
      typeId: "ash-imp",
      name: "Imp",
      health: 5,
      maxHealth: 5,
      boss: false,
      elite: false,
      action: "idle" as const,
      behavior: "melee" as const,
      windupProgress: 0,
      facing: { x: 0, y: 1 },
      hitRange: 1,
      hitArcCos: 0.5,
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

// Regression: without a torch nothing ahead is discovered, and prediction refused each step the
// server accepted, so the player froze and snapped forward in the dark.
describe("stepsIntoUndiscovered", () => {
  // Discovered floor on the left, ground never shown on the right.
  const dark = () => {
    const map = dungeon();
    map.map = { ...map.map, tiles: ["######", "#..  #", "#..  #", "######"] };
    return map;
  };

  it("flags a step onto ground the client has never been shown", () => {
    expect(stepsIntoUndiscovered(dark(), { x: 2.45, y: 1.5 }, { x: 1, y: 0 })).toBe(true);
  });

  it("predicts as normal on discovered floor and against a discovered wall", () => {
    expect(stepsIntoUndiscovered(dark(), { x: 1.5, y: 1.5 }, { x: 1, y: 0 })).toBe(false);
    expect(stepsIntoUndiscovered(dark(), { x: 0.6, y: 1 }, { x: -1, y: 0 })).toBe(false);
  });

  it("ignores a zero heading", () => {
    expect(stepsIntoUndiscovered(dark(), { x: 2.45, y: 1.5 }, { x: 0, y: 0 })).toBe(false);
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
