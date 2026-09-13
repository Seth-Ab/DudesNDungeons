import { describe, expect, it } from "vitest";
import { createDungeonState, movePlayer, spawnPointForIndex } from "../../src/server/game/dungeonState.js";
import type { Session, SessionPlayer } from "../../src/server/sessions/sessionStore.js";

function player(id: string, position = spawnPointForIndex(0)): SessionPlayer {
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

    const result = movePlayer(dungeonSession, actor.id, { x: 1, y: 0 });

    expect(result.ok).toBe(true);
    expect(actor.position.x).toBeGreaterThan(2);
    expect(actor.position.y).toBe(2);
    expect(actor.facing).toEqual({ x: 1, y: 0 });
  });

  it("rejects zero-length movement intent", () => {
    const actor = player("alpha");
    const dungeonSession = session([actor]);

    const result = movePlayer(dungeonSession, actor.id, { x: 0, y: 0 });

    expect(result).toEqual({ ok: false, reason: "outOfRange" });
    expect(actor.position).toEqual({ x: 2, y: 2 });
  });

  it("blocks movement into walls and map bounds", () => {
    const actor = player("alpha", { x: 1.05, y: 1 });
    const dungeonSession = session([actor]);

    const intoWall = movePlayer(dungeonSession, actor.id, { x: -1, y: 0 });

    expect(intoWall).toEqual({ ok: false, reason: "blocked" });
    expect(actor.position).toEqual({ x: 1.05, y: 1 });
  });

  it("blocks movement into another player's occupied space", () => {
    const actor = player("alpha", { x: 2, y: 2 });
    const blocker = player("beta", { x: 2.6, y: 2 });
    const dungeonSession = session([actor, blocker]);

    const result = movePlayer(dungeonSession, actor.id, { x: 1, y: 0 });

    expect(result).toEqual({ ok: false, reason: "blocked" });
    expect(actor.position).toEqual({ x: 2, y: 2 });
  });

  it("blocks movement into monsters and closed doors", () => {
    const nearMonster = player("alpha", { x: 10.4, y: 2 });
    const monsterSession = session([nearMonster]);

    expect(movePlayer(monsterSession, nearMonster.id, { x: 1, y: 0 })).toEqual({
      ok: false,
      reason: "blocked",
    });

    const nearDoor = player("beta", { x: 9.4, y: 6 });
    const doorSession = session([nearDoor]);

    expect(movePlayer(doorSession, nearDoor.id, { x: 1, y: 0 })).toEqual({
      ok: false,
      reason: "blocked",
    });
  });
});
