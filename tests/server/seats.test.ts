import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import { MOVE_INTERVAL_MS, isFloor, tileOf } from "../../src/shared/game/movement.js";
import { liftPlayer } from "../../src/server/game/carrying.js";
import { resolvePlayerAttack } from "../../src/server/game/combat.js";
import { HUB_DUNGEON_ID, movePlayer } from "../../src/server/game/dungeonState.js";
import { interact } from "../../src/server/game/items.js";
import { startRun } from "../../src/server/game/runLifecycle.js";
import { standPointFor } from "../../src/server/game/seats.js";
import { takeMapDiscovery } from "../../src/server/game/visibility.js";
import { SessionStore, toPlayerState, type Session } from "../../src/server/sessions/sessionStore.js";
import { SEAT_FACING_VECTORS } from "../../src/shared/constants/scenery.js";
import type { MapSeat } from "../../src/shared/types/core.js";
import { joinRequest, testPlayer, testSession } from "./fixtures.js";

/** Seats pinned in `content/dungeons/hub.json`. */
const WEST_BENCH_LEFT = "14f4b265-75ae-41f0-81ba-f62410dcc5b3";
const NORTH_RIM = "32924e4e-473a-4c26-b13a-4f8ba4376dfb";
const WEST_RIM = "556c3c11-fb36-4f2f-b4e3-9a2aec59a6e6";
const LOOT_TORCH = "a1111111-1111-4111-8111-111111111111";

function hubSession(names = ["sitter", "friend"]) {
  const players = names.map((name) => testPlayer(name, { carryingTorch: false }));
  const session = testSession(players, HUB_DUNGEON_ID);
  session.location = "hub";
  return { session, players };
}

function seat(session: Session, id: string): MapSeat {
  const found = session.dungeon.map.seats?.find((candidate) => candidate.id === id);
  if (!found) throw new Error(`No seat ${id}`);
  return found;
}

/** Puts a player on the floor right in front of a seat, where they can reach it. */
function standBefore(session: Session, player: ReturnType<typeof testPlayer>, seatId: string): void {
  player.position = standPointFor(session, seat(session, seatId));
}

function sitDown(session: Session, player: ReturnType<typeof testPlayer>, seatId = WEST_BENCH_LEFT): void {
  standBefore(session, player, seatId);
  expect(interact(session, player.id, seatId)).toEqual({ ok: true });
  expect(player.seatId).toBe(seatId);
}

/** Standing on walkable floor on the side the seat faces, as close as a body may be. */
function expectStoodInFront(session: Session, position: { x: number; y: number }, seatId: string): void {
  const placed = seat(session, seatId);
  const toward = SEAT_FACING_VECTORS[placed.facing];
  expect(isFloor(session.dungeon, position)).toBe(true);
  // Out past the seat along its facing, never behind it on the far side of the bench.
  expect((position.x - placed.x) * toward.x + (position.y - placed.y) * toward.y).toBeGreaterThan(0);
}

describe("hub seats", () => {
  it("places two seats on each bench and four on the fountain rim, each facing open floor", () => {
    const { session } = hubSession();
    const seats = session.dungeon.map.seats ?? [];

    expect(seats).toHaveLength(12);
    expect(new Set(seats.map((placed) => placed.id)).size).toBe(12);
    for (const placed of seats) {
      // The seat itself is on the solid bench or rim, and standing up lands on floor.
      expect(isFloor(session.dungeon, placed), placed.id).toBe(false);
      expect(isFloor(session.dungeon, standPointFor(session, placed)), placed.id).toBe(true);
    }
  });

  it("sends seats with map discovery, once each", () => {
    const { session, players } = hubSession(["viewer"]);
    const viewer = players[0]!;
    viewer.discoveredTiles = new Uint8Array(session.dungeon.map.width * session.dungeon.map.height).fill(1);

    const first = takeMapDiscovery(session, viewer);
    expect(first.reset).toBe(true);
    expect(first.seats?.map((placed) => placed.id).sort()).toEqual(
      (session.dungeon.map.seats ?? []).map((placed) => placed.id).sort(),
    );

    expect(takeMapDiscovery(session, viewer).seats).toBeUndefined();
  });
});

describe("sitting down", () => {
  it("moves a standing player in reach onto the seat and makes them face out", () => {
    const { session, players } = hubSession();
    const sitter = players[0]!;
    sitDown(session, sitter, NORTH_RIM);

    const placed = seat(session, NORTH_RIM);
    expect(sitter.position).toEqual({ x: placed.x, y: placed.y });
    expect(sitter.facing).toEqual(SEAT_FACING_VECTORS.north);
    expect(toPlayerState(sitter, session).seatId).toBe(NORTH_RIM);
  });

  it("refuses a seat out of range", () => {
    const { session, players } = hubSession();
    const sitter = players[0]!;
    sitter.position = { ...session.spawnPoints[3]! };

    expect(interact(session, sitter.id, WEST_BENCH_LEFT)).toEqual({ ok: false, reason: "outOfRange" });
    expect(sitter.seatId).toBeNull();
  });

  it("refuses a seat someone else is already on", () => {
    const { session, players } = hubSession();
    const [sitter, friend] = players as [ReturnType<typeof testPlayer>, ReturnType<typeof testPlayer>];
    sitDown(session, sitter);
    standBefore(session, friend, WEST_BENCH_LEFT);

    expect(interact(session, friend.id, WEST_BENCH_LEFT)).toEqual({ ok: false, reason: "blocked" });
    expect(friend.seatId).toBeNull();
  });

  it("refuses something that is not a seat", () => {
    const { session, players } = hubSession();
    const sitter = players[0]!;
    standBefore(session, sitter, WEST_BENCH_LEFT);

    expect(interact(session, sitter.id, LOOT_TORCH)).toEqual({ ok: false, reason: "targetMissing" });
    expect(interact(session, sitter.id, "00000000-0000-4000-8000-000000000000")).toEqual({
      ok: false,
      reason: "targetMissing",
    });
    expect(sitter.seatId).toBeNull();
  });

  it("refuses a downed, carried, carrying, or still-designing player", () => {
    const cases: [string, Partial<ReturnType<typeof testPlayer>>][] = [
      ["downed", { health: 0 }],
      ["carried", { health: 0, carriedByPlayerId: "friend" }],
      ["carrying", { carryingPlayerId: "friend" }],
      ["designing", { appearance: null }],
    ];

    for (const [label, state] of cases) {
      const { session, players } = hubSession();
      const sitter = players[0]!;
      standBefore(session, sitter, WEST_BENCH_LEFT);
      Object.assign(sitter, state);

      expect(interact(session, sitter.id, WEST_BENCH_LEFT), label).toEqual({
        ok: false,
        reason: "notPermitted",
      });
      expect(sitter.seatId, label).toBeNull();
    }
  });

  it("refuses a second seat while already sitting", () => {
    const { session, players } = hubSession();
    const sitter = players[0]!;
    sitDown(session, sitter);

    expect(interact(session, sitter.id, "c5152b1a-6f59-4aa3-b99e-836a35c9f056")).toEqual({
      ok: false,
      reason: "notPermitted",
    });
    expect(sitter.seatId).toBe(WEST_BENCH_LEFT);
  });
});

describe("standing up", () => {
  it("stands a mover up onto the floor the seat faces, and books the step", () => {
    const { session, players } = hubSession();
    const sitter = players[0]!;
    sitDown(session, sitter);

    const moved = movePlayer(session, sitter.id, { x: 1, y: 0 }, 1_000);

    expect(moved.ok).toBe(true);
    expect(sitter.seatId).toBeNull();
    expectStoodInFront(session, sitter.position, WEST_BENCH_LEFT);
    expect(sitter.nextMoveAt).toBe(1_000 + MOVE_INTERVAL_MS);
  });

  it("stands up on the near side when pushed into the bench or the fountain, and stays out", () => {
    for (const seatId of [WEST_BENCH_LEFT, NORTH_RIM, WEST_RIM]) {
      const { session, players } = hubSession();
      const sitter = players[0]!;
      sitDown(session, sitter, seatId);
      const toward = SEAT_FACING_VECTORS[seat(session, seatId).facing];
      const into = { x: -toward.x, y: -toward.y };

      expect(movePlayer(session, sitter.id, into, 1_000).ok, seatId).toBe(true);
      expect(sitter.seatId).toBeNull();
      expectStoodInFront(session, sitter.position, seatId);

      // Pressing on into the bench gets no further than its edge.
      for (let step = 1; step <= 20; step += 1) movePlayer(session, sitter.id, into, 1_000 + step * MOVE_INTERVAL_MS);
      expect(isFloor(session.dungeon, sitter.position), seatId).toBe(true);
      expectStoodInFront(session, sitter.position, seatId);
    }
  });

  it("stands up beside a friend standing right in front instead of on top of them", () => {
    const { session, players } = hubSession();
    const [sitter, friend] = players as [ReturnType<typeof testPlayer>, ReturnType<typeof testPlayer>];
    sitDown(session, sitter);
    standBefore(session, friend, WEST_BENCH_LEFT);

    movePlayer(session, sitter.id, { x: 0, y: 1 }, 1_000);

    expectStoodInFront(session, sitter.position, WEST_BENCH_LEFT);
    expect(Math.hypot(sitter.position.x - friend.position.x, sitter.position.y - friend.position.y)).toBeGreaterThanOrEqual(0.7);
  });

  it("is not moved by another player walking into them", () => {
    const { session, players } = hubSession();
    const [sitter, friend] = players as [ReturnType<typeof testPlayer>, ReturnType<typeof testPlayer>];
    sitDown(session, sitter);
    const seated = { ...sitter.position };
    standBefore(session, friend, WEST_BENCH_LEFT);

    for (let step = 0; step < 20; step += 1) movePlayer(session, friend.id, { x: 0, y: -1 }, step * MOVE_INTERVAL_MS);

    expect(sitter.position).toEqual(seated);
    expect(sitter.seatId).toBe(WEST_BENCH_LEFT);
    expect(isFloor(session.dungeon, friend.position)).toBe(true);
  });

  it("stands up to attack", () => {
    const { session, players } = hubSession();
    const sitter = players[0]!;
    sitDown(session, sitter);

    resolvePlayerAttack(session, sitter.id, { x: 0, y: 1 }, null, 1_000);

    expect(sitter.seatId).toBeNull();
    expectStoodInFront(session, sitter.position, WEST_BENCH_LEFT);
  });

  it("clears the seat of a player who is lifted, and stands up a seated lifter", () => {
    const { session, players } = hubSession();
    const [sitter, friend] = players as [ReturnType<typeof testPlayer>, ReturnType<typeof testPlayer>];
    sitDown(session, sitter);
    // Nothing downs a player in the hub yet; a sitter who somehow is still has to come off the seat.
    sitter.health = 0;
    standBefore(session, friend, WEST_BENCH_LEFT);

    expect(liftPlayer(session, friend.id, sitter.id)).toEqual({ ok: true });
    expect(sitter.seatId).toBeNull();
    expect(sitter.position).toEqual(friend.position);

    const lifter = hubSession();
    const [seatedLifter, downed] = lifter.players as [ReturnType<typeof testPlayer>, ReturnType<typeof testPlayer>];
    sitDown(lifter.session, seatedLifter);
    standBefore(lifter.session, downed, WEST_BENCH_LEFT);
    downed.health = 0;

    expect(liftPlayer(lifter.session, seatedLifter.id, downed.id)).toEqual({ ok: true });
    expect(seatedLifter.seatId).toBeNull();
    expectStoodInFront(lifter.session, seatedLifter.position, WEST_BENCH_LEFT);
  });

  it("clears every seat when the run starts", () => {
    const { session, players } = hubSession();
    const sitter = players[0]!;
    sitDown(session, sitter);
    for (const player of players) player.ready = true;

    expect(startRun(session, 0)).toEqual({ ok: true });
    expect(sitter.seatId).toBeNull();
    expect(isFloor(session.dungeon, sitter.position)).toBe(true);
  });
});

describe("seats across a disconnect", () => {
  it("stands a player up when they drop, and a reconnect in the grace window comes back standing", () => {
    let clock = 0;
    const store = new SessionStore({ now: () => clock, reconnectGraceMs: 30_000 });
    const session = store.createSession();
    const joined = store.join(joinRequest({ roomCode: session.roomCode, playerName: "Grix" }));
    if (!joined.ok) throw new Error(joined.message);
    store.setAppearance(joined.player.id, DEFAULT_APPEARANCE);
    const player = joined.player;
    sitDown(session, player);

    store.markDisconnected(player.id);
    expect(player.seatId).toBeNull();
    expectStoodInFront(session, player.position, WEST_BENCH_LEFT);

    clock += 10_000;
    const resumed = store.join(
      joinRequest({ roomCode: session.roomCode, playerName: "Grix", resumeToken: player.resumeToken }),
    );
    expect(resumed.ok).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.resumed).toBe(true);
    expect(resumed.player.seatId).toBeNull();
    expect(isFloor(session.dungeon, resumed.player.position)).toBe(true);
    expect(tileOf(resumed.player.position)).toEqual(tileOf(player.position));
  });
});
