import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import {
  MAX_EXTRAPOLATION_MS,
  REMOTE_RENDER_DELAY_MS,
  emptyRemoteInterpolation,
  remoteInterpolatedPosition,
  resetRemoteInterpolation,
  updateMonsterInterpolation,
  updateRemoteInterpolation,
  type RemoteInterpolationState,
} from "../../src/client/state/remoteInterpolation.js";
import { MOVE_INTERVAL_MS, PLAYER_STEP_DISTANCE } from "../../src/shared/game/movement.js";
import type { PlayerState } from "../../src/shared/types/core.js";

const PLAYER_ID = "00000000-0000-4000-8000-000000000000";
const STEP = PLAYER_STEP_DISTANCE;
/** Distance per millisecond of a player walking at full speed. */
const SPEED = STEP / MOVE_INTERVAL_MS;
const ORIGIN = { x: 0, y: 0 };

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

/** A snapshot arriving at `at`; `x` null means the player is absent from it. */
type Arrival = [at: number, x: number | null];

/**
 * Plays arrivals against a 1 ms render clock and records where the player is drawn each frame,
 * keyed by frame time. The first arrival seeds the player.
 */
function simulate(arrivals: readonly Arrival[], until: number): Map<number, number> {
  let state: RemoteInterpolationState = emptyRemoteInterpolation;
  const pending = [...arrivals];
  const drawn = new Map<number, number>();

  for (let now = arrivals[0]?.[0] ?? 0; now <= until; now += 1) {
    while (pending[0] && pending[0][0] <= now) {
      const [at, x] = pending[0];
      state = updateRemoteInterpolation(state, x === null ? [] : [player({ x, y: 0 })], at);
      pending.shift();
    }
    drawn.set(now, remoteInterpolatedPosition(state, PLAYER_ID, now, ORIGIN).x);
  }

  return drawn;
}

/** Per-millisecond movement across [from, to] of the recorded frames. */
function deltas(drawn: Map<number, number>, from: number, to: number): number[] {
  const result: number[] = [];
  for (let t = from + 1; t <= to; t += 1) {
    result.push((drawn.get(t) ?? 0) - (drawn.get(t - 1) ?? 0));
  }
  return result;
}

/** No frame ever moves faster than walking speed: no jump and no catch-up sprint. */
function expectNoJump(drawn: Map<number, number>): void {
  const times = [...drawn.keys()];
  const fastest = Math.max(
    ...deltas(drawn, Math.min(...times), Math.max(...times)).map((delta) => Math.abs(delta)),
  );
  expect(fastest).toBeLessThanOrEqual(SPEED * 1.001);
}

/** Every frame across the window moves at walking speed: no stop-start. */
function expectSteady(drawn: Map<number, number>, from: number, to: number): void {
  for (const delta of deltas(drawn, from, to)) {
    expect(delta).toBeCloseTo(SPEED, 9);
  }
}

/** One step every `MOVE_INTERVAL_MS`-ish, at the given arrival times. */
function walk(times: readonly number[]): Arrival[] {
  return times.map((at, step) => [at, step * STEP]);
}

describe("updateRemoteInterpolation", () => {
  it("snaps a player seen for the first time", () => {
    const state = updateRemoteInterpolation(emptyRemoteInterpolation, [player({ x: 3, y: 4 })], 0);

    expect(remoteInterpolatedPosition(state, PLAYER_ID, 0, ORIGIN)).toEqual({ x: 3, y: 4 });
  });

  it("draws positions a fixed delay in the past, sliding between them", () => {
    const seeded = updateRemoteInterpolation(emptyRemoteInterpolation, [player(ORIGIN)], 0);
    const moved = updateRemoteInterpolation(seeded, [player({ x: STEP, y: 0 })], MOVE_INTERVAL_MS);

    const drawnAt = (now: number) => remoteInterpolatedPosition(moved, PLAYER_ID, now, ORIGIN).x;
    expect(drawnAt(MOVE_INTERVAL_MS)).toBe(0);
    expect(drawnAt(REMOTE_RENDER_DELAY_MS + MOVE_INTERVAL_MS / 2)).toBeCloseTo(STEP / 2, 9);
    expect(drawnAt(REMOTE_RENDER_DELAY_MS + MOVE_INTERVAL_MS)).toBeCloseTo(STEP, 9);
  });

  it("draws a steady stream of snapshots at steady speed", () => {
    const drawn = simulate(walk([0, 50, 100, 150, 200, 250, 300]), 450);

    expectSteady(drawn, REMOTE_RENDER_DELAY_MS, 300 + REMOTE_RENDER_DELAY_MS);
    expectNoJump(drawn);
  });

  it("keeps steady speed when snapshots arrive at irregular intervals", () => {
    // LAN jitter: each arrival up to ~15 ms early or late.
    const drawn = simulate(walk([0, 62, 95, 160, 198, 255, 300, 350]), 500);

    expectSteady(drawn, REMOTE_RENDER_DELAY_MS, 350 + REMOTE_RENDER_DELAY_MS);
    expectNoJump(drawn);
  });

  it("spaces a burst of back-to-back snapshots instead of jumping", () => {
    // One snapshot held up 20 ms, then delivered moments before the next.
    const drawn = simulate(walk([0, 50, 100, 170, 172, 250, 300, 350]), 450);

    expectSteady(drawn, REMOTE_RENDER_DELAY_MS, 350 + REMOTE_RENDER_DELAY_MS);
    expectNoJump(drawn);
  });

  it("extrapolates briefly when the buffer runs dry, then settles and resumes smoothly", () => {
    // Nothing at all arrives between 200 and 400.
    const arrivals: Arrival[] = [...walk([0, 50, 100, 150, 200]), [400, 5 * STEP], [450, 6 * STEP]];
    const drawn = simulate(arrivals, 550);
    const lastSampleShown = 200 + REMOTE_RENDER_DELAY_MS;

    // Keeps moving past the last sample rather than freezing on it...
    expect(drawn.get(lastSampleShown + MAX_EXTRAPOLATION_MS / 2)).toBeCloseTo(4.5 * STEP, 9);
    // ...for a bounded time only.
    expect(drawn.get(lastSampleShown + MAX_EXTRAPOLATION_MS)).toBeCloseTo(5 * STEP, 9);
    expect(drawn.get(399)).toBeCloseTo(5 * STEP, 9);
    expectNoJump(drawn);
    expect(drawn.get(550)).toBeCloseTo(6 * STEP, 9);
  });

  it("settles back over a step when an extrapolated player turns out to have stopped", () => {
    const arrivals: Arrival[] = [...walk([0, 50, 100, 150, 200]), [400, 4 * STEP]];
    const drawn = simulate(arrivals, 600);

    expect(drawn.get(399)).toBeCloseTo(5 * STEP, 9);
    expectNoJump(drawn);
    expect(drawn.get(600)).toBeCloseTo(4 * STEP, 9);
  });

  it("stops without overshooting once snapshots confirm the player is standing still", () => {
    const stopped = 4 * STEP;
    const arrivals: Arrival[] = [
      ...walk([0, 50, 100, 150, 200]),
      [210, stopped],
      [260, stopped],
      [310, stopped],
      [360, stopped],
    ];
    const drawn = simulate(arrivals, 500);

    expect(Math.max(...drawn.values())).toBeCloseTo(stopped, 9);
    expectNoJump(drawn);
  });

  it("starts a player from rest at full speed", () => {
    const resting: Arrival[] = Array.from({ length: 20 }, (_, i): Arrival => [i * 50, 0]);
    const arrivals: Arrival[] = [...resting, [1000, STEP], [1050, 2 * STEP], [1100, 3 * STEP]];
    const drawn = simulate(arrivals, 1300);

    expect(drawn.get(1000 + REMOTE_RENDER_DELAY_MS - MOVE_INTERVAL_MS)).toBe(0);
    expectSteady(drawn, 1000 + REMOTE_RENDER_DELAY_MS - MOVE_INTERVAL_MS, 1100 + REMOTE_RENDER_DELAY_MS);
    expectNoJump(drawn);
  });

  it("does not snap a player who briefly drops out of the visible frame", () => {
    const arrivals: Arrival[] = [[0, 0], [50, STEP], [100, null], [150, 3 * STEP], [200, 4 * STEP]];
    const drawn = simulate(arrivals, 300);

    expectNoJump(drawn);
    expect(drawn.get(300)).toBeCloseTo(4 * STEP, 9);
  });

  it("snaps a player who returns after a long absence", () => {
    let state = updateRemoteInterpolation(emptyRemoteInterpolation, [player(ORIGIN)], 0);
    state = updateRemoteInterpolation(state, [], 50);
    state = updateRemoteInterpolation(state, [], 1000);
    expect(state.has(PLAYER_ID)).toBe(false);

    state = updateRemoteInterpolation(state, [player({ x: 1, y: 0 })], 1050);
    expect(remoteInterpolatedPosition(state, PLAYER_ID, 1050, ORIGIN)).toEqual({ x: 1, y: 0 });
  });

  it("snaps instead of sliding on a large correction", () => {
    const seeded = updateRemoteInterpolation(emptyRemoteInterpolation, [player(ORIGIN)], 0);
    const corrected = updateRemoteInterpolation(seeded, [player({ x: 50, y: 0 })], 1);

    expect(remoteInterpolatedPosition(corrected, PLAYER_ID, 1, ORIGIN)).toEqual({ x: 50, y: 0 });
  });
});

describe("resetRemoteInterpolation", () => {
  it("snaps every player to their current position for a world transition", () => {
    const seeded = updateRemoteInterpolation(emptyRemoteInterpolation, [player(ORIGIN)], 0);
    const slidingTo = updateRemoteInterpolation(seeded, [player({ x: 1, y: 0 })], 50);

    const reset = resetRemoteInterpolation([player({ x: 9, y: 9 })], 100);

    expect(remoteInterpolatedPosition(reset, PLAYER_ID, 100, ORIGIN)).toEqual({ x: 9, y: 9 });
    // A read against the pre-transition state is still mid-slide; the reset state must be a wholly
    // separate map, not a mutation of it.
    expect(
      remoteInterpolatedPosition(slidingTo, PLAYER_ID, 50, ORIGIN),
    ).toEqual({ x: 0, y: 0 });
  });
});

describe("updateMonsterInterpolation", () => {
  const MONSTER_ID = "00000000-0000-4000-8000-0000000000aa";
  const monster = (x: number, alive = true) => ({ id: MONSTER_ID, position: { x, y: 0 }, alive });
  const drawnAt = (state: RemoteInterpolationState, now: number) =>
    remoteInterpolatedPosition(state, MONSTER_ID, now, { x: -1, y: -1 }).x;

  it("draws a monster between snapshots, not at the raw coordinates", () => {
    const seeded = updateMonsterInterpolation(emptyRemoteInterpolation, [monster(0)], 0);
    const moved = updateMonsterInterpolation(seeded, [monster(STEP)], MOVE_INTERVAL_MS);

    expect(drawnAt(moved, MOVE_INTERVAL_MS)).toBe(0);
    expect(drawnAt(moved, REMOTE_RENDER_DELAY_MS + MOVE_INTERVAL_MS / 2)).toBeCloseTo(STEP / 2, 9);
    expect(drawnAt(moved, REMOTE_RENDER_DELAY_MS + MOVE_INTERVAL_MS)).toBeCloseTo(STEP, 9);
  });

  it("caps extrapolation when no snapshot arrives", () => {
    const seeded = updateMonsterInterpolation(emptyRemoteInterpolation, [monster(0)], 0);
    const moved = updateMonsterInterpolation(seeded, [monster(STEP)], MOVE_INTERVAL_MS);
    const end = MOVE_INTERVAL_MS + REMOTE_RENDER_DELAY_MS;

    expect(drawnAt(moved, end + 10 * MAX_EXTRAPOLATION_MS)).toBeCloseTo(STEP + SPEED * MAX_EXTRAPOLATION_MS, 9);
  });

  it("snaps a large jump instead of sliding", () => {
    const seeded = updateMonsterInterpolation(emptyRemoteInterpolation, [monster(0)], 0);
    const jumped = updateMonsterInterpolation(seeded, [monster(40)], 1);

    expect(drawnAt(jumped, 1)).toBe(40);
  });

  it("drops the track of a monster that left the snapshot, so it snaps back in", () => {
    let state = updateMonsterInterpolation(emptyRemoteInterpolation, [monster(0)], 0);
    state = updateMonsterInterpolation(state, [], 50);
    expect(state.has(MONSTER_ID)).toBe(false);
    expect(drawnAt(state, 50)).toBe(-1);

    state = updateMonsterInterpolation(state, [monster(1)], 100);
    expect(drawnAt(state, 100)).toBe(1);
  });

  it("drops the track of a monster that died", () => {
    let state = updateMonsterInterpolation(emptyRemoteInterpolation, [monster(0)], 0);
    state = updateMonsterInterpolation(state, [monster(STEP, false)], 50);

    expect(state.has(MONSTER_ID)).toBe(false);
  });

  it("snaps a new monster that reuses an id from a stale position", () => {
    let state = updateMonsterInterpolation(emptyRemoteInterpolation, [monster(0)], 0);
    state = updateMonsterInterpolation(state, [], 50);
    state = updateMonsterInterpolation(state, [monster(1.5)], 60);

    expect(drawnAt(state, 60)).toBe(1.5);
  });
});
