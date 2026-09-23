import { describe, expect, it } from "vitest";
import {
  REMOTE_INTERPOLATION_MS,
  emptyRemoteInterpolation,
  remoteInterpolatedPosition,
  resetRemoteInterpolation,
  updateRemoteInterpolation,
} from "../../src/client/state/remoteInterpolation.js";
import type { PlayerState } from "../../src/shared/types/core.js";

const PLAYER_ID = "00000000-0000-4000-8000-000000000000";

function player(position: { x: number; y: number }, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: PLAYER_ID,
    name: "Other",
    position,
    facing: { x: 0, y: 1 },
    health: 100,
    resistance: 40,
    stamina: 100,
    ready: false,
    connected: true,
    inventory: [],
    carryingTorch: false,
    bankedItems: [],
    ...overrides,
  };
}

describe("updateRemoteInterpolation", () => {
  it("snaps a player seen for the first time", () => {
    const state = updateRemoteInterpolation(emptyRemoteInterpolation, [player({ x: 3, y: 4 })], 0);

    expect(remoteInterpolatedPosition(state, PLAYER_ID, 0, { x: 0, y: 0 })).toEqual({
      x: 3,
      y: 4,
    });
  });

  it("slides across normal movement between two snapshots", () => {
    const seeded = updateRemoteInterpolation(emptyRemoteInterpolation, [player({ x: 0, y: 0 })], 0);
    const moved = updateRemoteInterpolation(seeded, [player({ x: 1, y: 0 })], 0);

    expect(remoteInterpolatedPosition(moved, PLAYER_ID, 0, { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 0,
    });
    expect(
      remoteInterpolatedPosition(moved, PLAYER_ID, REMOTE_INTERPOLATION_MS / 2, {
        x: 0,
        y: 0,
      }),
    ).toEqual({ x: 0.5, y: 0 });
    expect(
      remoteInterpolatedPosition(moved, PLAYER_ID, REMOTE_INTERPOLATION_MS, { x: 0, y: 0 }),
    ).toEqual({ x: 1, y: 0 });
  });

  it("never advances past the latest authoritative target on a stale or delayed read", () => {
    const seeded = updateRemoteInterpolation(emptyRemoteInterpolation, [player({ x: 0, y: 0 })], 0);
    const moved = updateRemoteInterpolation(seeded, [player({ x: 1, y: 0 })], 0);

    // Read long after the slide should have finished; a stale snapshot must not overshoot.
    expect(
      remoteInterpolatedPosition(moved, PLAYER_ID, REMOTE_INTERPOLATION_MS * 10, {
        x: 0,
        y: 0,
      }),
    ).toEqual({ x: 1, y: 0 });
  });

  it("continues the slide from wherever it is currently drawn under an irregular interval", () => {
    const seeded = updateRemoteInterpolation(emptyRemoteInterpolation, [player({ x: 0, y: 0 })], 0);
    // A snapshot lands halfway through the previous slide, before it settled.
    const early = updateRemoteInterpolation(
      seeded,
      [player({ x: 1, y: 0 })],
      REMOTE_INTERPOLATION_MS / 4,
    );

    expect(
      remoteInterpolatedPosition(early, PLAYER_ID, REMOTE_INTERPOLATION_MS / 4, {
        x: 0,
        y: 0,
      }),
    ).toEqual({ x: 0, y: 0 });
  });

  it("snaps instead of sliding on a large correction", () => {
    const seeded = updateRemoteInterpolation(emptyRemoteInterpolation, [player({ x: 0, y: 0 })], 0);
    const corrected = updateRemoteInterpolation(seeded, [player({ x: 50, y: 0 })], 1);

    expect(remoteInterpolatedPosition(corrected, PLAYER_ID, 1, { x: 0, y: 0 })).toEqual({
      x: 50,
      y: 0,
    });
  });
});

describe("resetRemoteInterpolation", () => {
  it("snaps every player to their current position for a world transition", () => {
    const seeded = updateRemoteInterpolation(emptyRemoteInterpolation, [player({ x: 0, y: 0 })], 0);
    const slidingTo = updateRemoteInterpolation(seeded, [player({ x: 1, y: 0 })], 0);

    const reset = resetRemoteInterpolation([player({ x: 9, y: 9 })], 100);

    expect(remoteInterpolatedPosition(reset, PLAYER_ID, 100, { x: 0, y: 0 })).toEqual({
      x: 9,
      y: 9,
    });
    // A stale read against the pre-transition state would still be mid-slide; the reset state
    // must be a wholly separate map, not a mutation of it.
    expect(remoteInterpolatedPosition(slidingTo, PLAYER_ID, 0, { x: 0, y: 0 })).toEqual({
      x: 0,
      y: 0,
    });
  });
});
