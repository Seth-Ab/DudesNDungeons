import { describe, expect, it } from "vitest";
import {
  canOccupy,
  createDungeonState,
  findSpawnPoint,
  movePlayer,
} from "../../src/server/game/dungeonState.js";
import type { Session, SessionPlayer } from "../../src/server/sessions/sessionStore.js";
import {
  MOVE_BURST_TOLERANCE_MS,
  MOVE_INTERVAL_MS,
  PLAYER_STEP_DISTANCE,
} from "../../src/shared/game/movement.js";

const SPAWN_POINTS = [
  { x: 2, y: 2 },
  { x: 2, y: 5 },
  { x: 13, y: 2 },
  { x: 13, y: 5 },
];

function player(id: string, position = { x: 2, y: 2 }): SessionPlayer {
  return {
    id,
    name: id,
    position,
    facing: { x: 0, y: 1 },
    health: 100,
    ready: false,
    connected: true,
    resumeToken: `${id}`.padEnd(32, "0"),
    disconnectedAt: null,
    nextMoveAt: null,
  };
}

function session(players: SessionPlayer[]): Session {
  return {
    id: "session-1",
    roomCode: "ROOM01",
    createdAt: 0,
    dungeon: createDungeonState(),
    tick: 0,
    players: new Map(players.map((member) => [member.id, member])),
  };
}

describe("dungeon movement", () => {
  it("moves a player by a server-owned step and updates facing", () => {
    const actor = player("alpha");
    const dungeonSession = session([actor]);

    const result = movePlayer(dungeonSession, actor.id, { x: 1, y: 0 }, 0);

    expect(result.ok).toBe(true);
    expect(actor.position.x).toBeGreaterThan(2);
    expect(actor.position.y).toBe(2);
    expect(actor.facing).toEqual({ x: 1, y: 0 });
  });

  it("rejects zero-length movement intent", () => {
    const actor = player("alpha");
    const dungeonSession = session([actor]);

    const result = movePlayer(dungeonSession, actor.id, { x: 0, y: 0 }, 0);

    expect(result).toEqual({ ok: false, reason: "outOfRange" });
    expect(actor.position).toEqual({ x: 2, y: 2 });
  });

  it("blocks movement into walls and map bounds", () => {
    const actor = player("alpha", { x: 1.05, y: 1 });
    const dungeonSession = session([actor]);

    const intoWall = movePlayer(dungeonSession, actor.id, { x: -1, y: 0 }, 0);

    expect(intoWall).toEqual({ ok: false, reason: "blocked" });
    expect(actor.position).toEqual({ x: 1.05, y: 1 });
  });

  it("blocks movement into another player's occupied space", () => {
    const actor = player("alpha", { x: 2, y: 2 });
    const blocker = player("beta", { x: 2.6, y: 2 });
    const dungeonSession = session([actor, blocker]);

    const result = movePlayer(dungeonSession, actor.id, { x: 1, y: 0 }, 0);

    expect(result).toEqual({ ok: false, reason: "blocked" });
    expect(actor.position).toEqual({ x: 2, y: 2 });
  });

  it("lets players who already overlap step apart, but not closer", () => {
    const actor = player("alpha", { x: 2, y: 2 });
    const other = player("beta", { x: 2.3, y: 2 });
    const dungeonSession = session([actor, other]);

    expect(movePlayer(dungeonSession, actor.id, { x: 1, y: 0 }, 0)).toEqual({
      ok: false,
      reason: "blocked",
    });
    expect(movePlayer(dungeonSession, actor.id, { x: -1, y: 0 }, 0).ok).toBe(true);
  });

  it("blocks movement into monsters and closed doors", () => {
    const nearMonster = player("alpha", { x: 10.4, y: 2 });
    const monsterSession = session([nearMonster]);

    expect(movePlayer(monsterSession, nearMonster.id, { x: 1, y: 0 }, 0)).toEqual({
      ok: false,
      reason: "blocked",
    });

    const nearDoor = player("beta", { x: 9.4, y: 6 });
    const doorSession = session([nearDoor]);

    expect(movePlayer(doorSession, nearDoor.id, { x: 1, y: 0 }, 0)).toEqual({
      ok: false,
      reason: "blocked",
    });
  });
});

describe("movement pacing", () => {
  it("refuses a move that arrives too far ahead of the schedule", () => {
    const actor = player("alpha");
    const dungeonSession = session([actor]);

    // The first move and one move of burst tolerance land together; the next is early.
    expect(movePlayer(dungeonSession, actor.id, { x: 1, y: 0 }, 0).ok).toBe(true);
    expect(movePlayer(dungeonSession, actor.id, { x: 1, y: 0 }, 0).ok).toBe(true);
    expect(movePlayer(dungeonSession, actor.id, { x: 1, y: 0 }, 1)).toEqual({
      ok: false,
      reason: "onCooldown",
    });
    expect(actor.position.x).toBeCloseTo(2 + 2 * PLAYER_STEP_DISTANCE);

    expect(
      movePlayer(dungeonSession, actor.id, { x: 1, y: 0 }, 2 * MOVE_INTERVAL_MS - MOVE_BURST_TOLERANCE_MS)
        .ok,
    ).toBe(true);
  });

  it("accepts evenly sent intents that network jitter bunched together", () => {
    const actor = player("alpha", { x: 2, y: 1 });
    const dungeonSession = session([actor]);

    // Sent every 50ms, but the third arrived 30ms after the second.
    for (const now of [0, 60, 90, 150, 200]) {
      expect(movePlayer(dungeonSession, actor.id, { x: 0, y: 1 }, now).ok).toBe(true);
    }
  });

  it("caps long-run speed however fast intents arrive", () => {
    const actor = player("alpha", { x: 2, y: 1 });
    const dungeonSession = session([actor]);
    const durationMs = 1000;

    let accepted = 0;
    for (let now = 0; now < durationMs; now += 1) {
      if (movePlayer(dungeonSession, actor.id, { x: 0, y: 1 }, now).ok) accepted += 1;
    }

    // One move per interval, plus the single move of burst tolerance and the move at time zero.
    expect(accepted).toBeLessThanOrEqual(durationMs / MOVE_INTERVAL_MS + 2);
    expect(accepted).toBeGreaterThanOrEqual(durationMs / MOVE_INTERVAL_MS);
  });

  it("does not book time for a blocked move", () => {
    const actor = player("alpha", { x: 1.05, y: 1 });
    const dungeonSession = session([actor]);

    for (let attempt = 0; attempt < 3; attempt += 1) {
      expect(movePlayer(dungeonSession, actor.id, { x: -1, y: 0 }, 0).ok).toBe(false);
    }
    expect(movePlayer(dungeonSession, actor.id, { x: 1, y: 0 }, 0).ok).toBe(true);
    expect(movePlayer(dungeonSession, actor.id, { x: 1, y: 0 }, 0).ok).toBe(true);
  });
});

describe("spawning", () => {
  it("uses the first spawn point in an empty dungeon", () => {
    expect(findSpawnPoint(session([]))).toEqual({ x: 2, y: 2 });
  });

  it("skips spawn points another player is standing on", () => {
    // Two players joined and the first left: the second still holds the second spawn point.
    const dungeonSession = session([player("beta", { x: 2, y: 5 }), player("gamma", { x: 2, y: 2 })]);

    expect(findSpawnPoint(dungeonSession)).toEqual({ x: 13, y: 2 });
  });

  it("falls back to free floor when every spawn point is taken", () => {
    const dungeonSession = session(
      SPAWN_POINTS.map((point, index) => player(`player-${index}`, { ...point })),
    );

    const spawn = findSpawnPoint(dungeonSession);

    expect(SPAWN_POINTS).not.toContainEqual(spawn);
    expect(canOccupy(dungeonSession, spawn)).toBe(true);
  });
});
