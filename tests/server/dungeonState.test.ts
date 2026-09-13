import { describe, expect, it } from "vitest";
import { canOccupy, findSpawnPoint, movePlayer } from "../../src/server/game/dungeonState.js";
import {
  MOVE_BURST_TOLERANCE_MS,
  MOVE_INTERVAL_MS,
  PLAYER_STEP_DISTANCE,
} from "../../src/shared/game/movement.js";
import { testPlayer, testSession } from "./fixtures.js";

const SPAWN_POINTS = [
  { x: 2, y: 2 },
  { x: 2, y: 5 },
  { x: 4, y: 1 },
  { x: 2, y: 6 },
];

describe("dungeon movement", () => {
  it("moves a player by a server-owned step and updates facing", () => {
    const actor = testPlayer("alpha");
    const session = testSession([actor]);

    const result = movePlayer(session, actor.id, { x: 1, y: 0 }, 0);

    expect(result.ok).toBe(true);
    expect(actor.position.x).toBeGreaterThan(2);
    expect(actor.position.y).toBe(2);
    expect(actor.facing).toEqual({ x: 1, y: 0 });
  });

  it("rejects zero-length movement intent", () => {
    const actor = testPlayer("alpha");
    const session = testSession([actor]);

    const result = movePlayer(session, actor.id, { x: 0, y: 0 }, 0);

    expect(result).toEqual({ ok: false, reason: "outOfRange" });
    expect(actor.position).toEqual({ x: 2, y: 2 });
  });

  // Integer positions are tile centers, so the wall tile at x = 0 starts at x = 0.5.
  it("blocks movement into walls and map bounds", () => {
    const actor = testPlayer("alpha", { position: { x: 0.6, y: 1 } });
    const session = testSession([actor]);

    const intoWall = movePlayer(session, actor.id, { x: -1, y: 0 }, 0);

    expect(intoWall).toEqual({ ok: false, reason: "blocked" });
    expect(actor.position).toEqual({ x: 0.6, y: 1 });
  });

  it("blocks movement into another player's occupied space", () => {
    const actor = testPlayer("alpha", { position: { x: 2, y: 2 } });
    const blocker = testPlayer("beta", { position: { x: 2.6, y: 2 } });
    const session = testSession([actor, blocker]);

    const result = movePlayer(session, actor.id, { x: 1, y: 0 }, 0);

    expect(result).toEqual({ ok: false, reason: "blocked" });
    expect(actor.position).toEqual({ x: 2, y: 2 });
  });

  it("lets players who already overlap step apart, but not closer", () => {
    const actor = testPlayer("alpha", { position: { x: 2, y: 2 } });
    const other = testPlayer("beta", { position: { x: 2.3, y: 2 } });
    const session = testSession([actor, other]);

    expect(movePlayer(session, actor.id, { x: 1, y: 0 }, 0)).toEqual({
      ok: false,
      reason: "blocked",
    });
    expect(movePlayer(session, actor.id, { x: -1, y: 0 }, 0).ok).toBe(true);
  });

  it("walks through a downed player", () => {
    const actor = testPlayer("alpha", { position: { x: 2, y: 2 } });
    const downed = testPlayer("beta", { position: { x: 2.6, y: 2 }, health: 0 });
    const session = testSession([actor, downed]);

    expect(movePlayer(session, actor.id, { x: 1, y: 0 }, 0).ok).toBe(true);
  });

  it("does not let a downed player move", () => {
    const actor = testPlayer("alpha", { health: 0 });
    const session = testSession([actor]);

    expect(movePlayer(session, actor.id, { x: 1, y: 0 }, 0)).toEqual({
      ok: false,
      reason: "notPermitted",
    });
  });

  it("blocks movement into monsters", () => {
    const actor = testPlayer("alpha", { position: { x: 10.4, y: 2 } });
    const session = testSession([actor]);

    expect(movePlayer(session, actor.id, { x: 1, y: 0 }, 0)).toEqual({
      ok: false,
      reason: "blocked",
    });
  });

  it("treats a closed door's whole tile as solid, and an open one as floor", () => {
    const actor = testPlayer("alpha", { position: { x: 10.45, y: 5.6 } });
    const session = testSession([actor]);

    expect(movePlayer(session, actor.id, { x: 1, y: 0 }, 0)).toEqual({
      ok: false,
      reason: "blocked",
    });

    const door = session.dungeon.doors[0];
    if (!door) throw new Error("Ember Vault has a door");
    door.open = true;

    expect(movePlayer(session, actor.id, { x: 1, y: 0 }, 0).ok).toBe(true);
  });
});

describe("movement pacing", () => {
  it("refuses a move that arrives too far ahead of the schedule", () => {
    const actor = testPlayer("alpha");
    const session = testSession([actor]);

    // The first move and one move of burst tolerance land together; the next is early.
    expect(movePlayer(session, actor.id, { x: 1, y: 0 }, 0).ok).toBe(true);
    expect(movePlayer(session, actor.id, { x: 1, y: 0 }, 0).ok).toBe(true);
    expect(movePlayer(session, actor.id, { x: 1, y: 0 }, 1)).toEqual({
      ok: false,
      reason: "onCooldown",
    });
    expect(actor.position.x).toBeCloseTo(2 + 2 * PLAYER_STEP_DISTANCE);

    expect(
      movePlayer(session, actor.id, { x: 1, y: 0 }, 2 * MOVE_INTERVAL_MS - MOVE_BURST_TOLERANCE_MS)
        .ok,
    ).toBe(true);
  });

  it("accepts evenly sent intents that network jitter bunched together", () => {
    const actor = testPlayer("alpha", { position: { x: 2, y: 1 } });
    const session = testSession([actor]);

    // Sent every 50ms, but the third arrived 30ms after the second.
    for (const now of [0, 60, 90, 150, 200]) {
      expect(movePlayer(session, actor.id, { x: 0, y: 1 }, now).ok).toBe(true);
    }
  });

  it("caps long-run speed however fast intents arrive", () => {
    const actor = testPlayer("alpha", { position: { x: 2, y: 1 } });
    const session = testSession([actor]);
    const durationMs = 1000;

    let accepted = 0;
    for (let now = 0; now < durationMs; now += 1) {
      if (movePlayer(session, actor.id, { x: 0, y: 1 }, now).ok) accepted += 1;
    }

    // One move per interval, plus the single move of burst tolerance and the move at time zero.
    expect(accepted).toBeLessThanOrEqual(durationMs / MOVE_INTERVAL_MS + 2);
    expect(accepted).toBeGreaterThanOrEqual(durationMs / MOVE_INTERVAL_MS);
  });

  it("does not book time for a blocked move", () => {
    const actor = testPlayer("alpha", { position: { x: 0.6, y: 1 } });
    const session = testSession([actor]);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(movePlayer(session, actor.id, { x: -1, y: 0 }, 0).ok).toBe(false);
    }
    expect(movePlayer(session, actor.id, { x: 1, y: 0 }, 0).ok).toBe(true);
    expect(movePlayer(session, actor.id, { x: 1, y: 0 }, 0).ok).toBe(true);
  });
});

describe("spawning", () => {
  it("uses the first spawn point in an empty dungeon", () => {
    expect(findSpawnPoint(testSession([]))).toEqual({ x: 2, y: 2 });
  });

  it("skips spawn points another player is standing on", () => {
    // Two players joined and the first left: the second still holds the second spawn point.
    const session = testSession([
      testPlayer("beta", { position: { x: 2, y: 5 } }),
      testPlayer("gamma", { position: { x: 2, y: 2 } }),
    ]);

    expect(findSpawnPoint(session)).toEqual({ x: 4, y: 1 });
  });

  it("reuses a spawn point a downed player is lying on", () => {
    const session = testSession([testPlayer("beta", { position: { x: 2, y: 2 }, health: 0 })]);

    expect(findSpawnPoint(session)).toEqual({ x: 2, y: 2 });
  });

  it("falls back to free floor when every spawn point is taken", () => {
    const session = testSession(
      SPAWN_POINTS.map((point, index) => testPlayer(`player-${index}`, { position: { ...point } })),
    );

    const spawn = findSpawnPoint(session);

    expect(SPAWN_POINTS).not.toContainEqual(spawn);
    expect(canOccupy(session, spawn)).toBe(true);
  });
});
