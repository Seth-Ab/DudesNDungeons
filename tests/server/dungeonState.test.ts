import { describe, expect, it } from "vitest";
import { canOccupy, findSpawnPoint, movePlayer } from "../../src/server/game/dungeonState.js";
import {
  MOVE_BURST_TOLERANCE_MS,
  MOVE_INTERVAL_MS,
  PLAYER_STEP_DISTANCE,
} from "../../src/shared/game/movement.js";
import { TILE_SCALE } from "../../src/shared/constants/game.js";
import { at, testPlayer, testSession } from "./fixtures.js";

/** The Ember Vault's authored spawn tiles, in the world coordinates they are played at. */
const SPAWN_POINTS = [at(2, 2), at(2, 5), at(4, 1), at(2, 6)];

/**
 * A world position just inside the vault's west wall.
 *
 * The wall is one authored tile, so it fills world columns 0 to `TILE_SCALE - 1` and the first
 * floor column starts at `TILE_SCALE - 0.5`. Standing a little past that edge, one step west is
 * into the wall.
 */
const AGAINST_WEST_WALL = { x: TILE_SCALE - 0.4, y: at(1, 1).y };

describe("dungeon movement", () => {
  it("moves a player by a server-owned step and updates facing", () => {
    const actor = testPlayer("alpha");
    const session = testSession([actor]);

    const result = movePlayer(session, actor.id, { x: 1, y: 0 }, 0);

    expect(result.ok).toBe(true);
    expect(actor.position.x).toBeGreaterThan(at(2, 2).x);
    expect(actor.position.y).toBe(at(2, 2).y);
    expect(actor.facing).toEqual({ x: 1, y: 0 });
  });

  it("rejects zero-length movement intent", () => {
    const actor = testPlayer("alpha");
    const session = testSession([actor]);

    const result = movePlayer(session, actor.id, { x: 0, y: 0 }, 0);

    expect(result).toEqual({ ok: false, reason: "outOfRange" });
    expect(actor.position).toEqual(at(2, 2));
  });

  // Integer positions are tile centers, so a tile at x = n starts at x = n - 0.5.
  it("blocks movement into walls and map bounds", () => {
    const actor = testPlayer("alpha", { position: { ...AGAINST_WEST_WALL } });
    const session = testSession([actor]);

    const intoWall = movePlayer(session, actor.id, { x: -1, y: 0 }, 0);

    expect(intoWall).toEqual({ ok: false, reason: "blocked" });
    expect(actor.position).toEqual(AGAINST_WEST_WALL);
  });

  it("blocks movement into another player's occupied space", () => {
    const actor = testPlayer("alpha", { position: at(2, 2) });
    const blocker = testPlayer("beta", { position: at(2, 2, 0.6) });
    const session = testSession([actor, blocker]);

    const result = movePlayer(session, actor.id, { x: 1, y: 0 }, 0);

    expect(result).toEqual({ ok: false, reason: "blocked" });
    expect(actor.position).toEqual(at(2, 2));
  });

  it("lets players who already overlap step apart, but not closer", () => {
    const actor = testPlayer("alpha", { position: at(2, 2) });
    const other = testPlayer("beta", { position: at(2, 2, 0.3) });
    const session = testSession([actor, other]);

    expect(movePlayer(session, actor.id, { x: 1, y: 0 }, 0)).toEqual({
      ok: false,
      reason: "blocked",
    });
    expect(movePlayer(session, actor.id, { x: -1, y: 0 }, 0).ok).toBe(true);
  });

  it("walks through a downed player", () => {
    const actor = testPlayer("alpha", { position: at(2, 2) });
    const downed = testPlayer("beta", { position: at(2, 2, 0.6), health: 0 });
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
    // The vault's ash imp stands on tile (11, 2); this is just short of its body.
    const actor = testPlayer("alpha", { position: at(11, 2, -0.9) });
    const session = testSession([actor]);

    expect(movePlayer(session, actor.id, { x: 1, y: 0 }, 0)).toEqual({
      ok: false,
      reason: "blocked",
    });
  });

  // The locked door is authored on tile (11, 6), so closed it fills every world column of it. The
  // player stands in the last world column of tile (10, 6), one step short of the doorway.
  it("treats a closed door's whole tile as solid, and an open one as floor", () => {
    const actor = testPlayer("alpha", { position: at(10, 6, 1.9) });
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
    expect(actor.position.x).toBeCloseTo(at(2, 2).x + 2 * PLAYER_STEP_DISTANCE);

    expect(
      movePlayer(session, actor.id, { x: 1, y: 0 }, 2 * MOVE_INTERVAL_MS - MOVE_BURST_TOLERANCE_MS)
        .ok,
    ).toBe(true);
  });

  it("accepts evenly sent intents that network jitter bunched together", () => {
    const actor = testPlayer("alpha", { position: at(2, 1) });
    const session = testSession([actor]);

    // Sent every 50ms, but the third arrived 30ms after the second.
    for (const now of [0, 60, 90, 150, 200]) {
      expect(movePlayer(session, actor.id, { x: 0, y: 1 }, now).ok).toBe(true);
    }
  });

  it("caps long-run speed however fast intents arrive", () => {
    const actor = testPlayer("alpha", { position: at(2, 1) });
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
    const actor = testPlayer("alpha", { position: { ...AGAINST_WEST_WALL } });
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
    expect(findSpawnPoint(testSession([]))).toEqual(at(2, 2));
  });

  it("skips spawn points another player is standing on", () => {
    // Two players joined and the first left: the second still holds the second spawn point.
    const session = testSession([
      testPlayer("beta", { position: at(2, 5) }),
      testPlayer("gamma", { position: at(2, 2) }),
    ]);

    expect(findSpawnPoint(session)).toEqual(at(4, 1));
  });

  it("reuses a spawn point a downed player is lying on", () => {
    const session = testSession([testPlayer("beta", { position: at(2, 2), health: 0 })]);

    expect(findSpawnPoint(session)).toEqual(at(2, 2));
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
