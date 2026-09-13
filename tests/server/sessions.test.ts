import { beforeEach, describe, expect, it } from "vitest";
import { PLAYER_MAX_HEALTH } from "../../src/shared/constants/game.js";
import {
  SessionStore,
  rosterOf,
  toPlayerState,
  type Session,
} from "../../src/server/sessions/sessionStore.js";

const GRACE_MS = 60_000;
const EMPTY_TTL_MS = 600_000;

let clock = 0;
let counter = 0;

function createStore(overrides: Partial<ConstructorParameters<typeof SessionStore>[0]> = {}) {
  return new SessionStore({
    now: () => clock,
    createPlayerId: () => `player-${(counter += 1)}`,
    createSessionId: () => `session-${(counter += 1)}`,
    createResumeToken: () => `token-${(counter += 1)}`,
    createRoomCode: () => `ROOM${(counter += 1)}`,
    reconnectGraceMs: GRACE_MS,
    emptySessionTtlMs: EMPTY_TTL_MS,
    ...overrides,
  });
}

function joinOrThrow(store: SessionStore, session: Session, playerName: string) {
  const result = store.join({ roomCode: session.roomCode, playerName });
  if (!result.ok) throw new Error(`expected join to succeed, got ${result.code}`);
  return result;
}

beforeEach(() => {
  clock = 0;
  counter = 0;
});

describe("session creation and joining", () => {
  it("places a joining player at full health and not ready", () => {
    const store = createStore();
    const session = store.createSession();

    const { player, resumed } = joinOrThrow(store, session, "Grix");

    expect(resumed).toBe(false);
    expect(player.health).toBe(PLAYER_MAX_HEALTH);
    expect(player.ready).toBe(false);
    expect(player.connected).toBe(true);
    expect(session.players.size).toBe(1);
  });

  it("rejects a join for a room code that does not exist", () => {
    const store = createStore();
    store.createSession();

    const result = store.join({ roomCode: "NOSUCH", playerName: "Grix" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("sessionNotFound");
  });

  it("rejects a join once the party is full", () => {
    const store = createStore({ maxPartySize: 2 });
    const session = store.createSession();
    joinOrThrow(store, session, "One");
    joinOrThrow(store, session, "Two");

    const result = store.join({ roomCode: session.roomCode, playerName: "Three" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("sessionFull");
  });

  it("keeps a disconnected player's slot reserved against the party limit", () => {
    const store = createStore({ maxPartySize: 2 });
    const session = store.createSession();
    const first = joinOrThrow(store, session, "One");
    joinOrThrow(store, session, "Two");
    store.markDisconnected(first.player.id);

    const result = store.join({ roomCode: session.roomCode, playerName: "Three" });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("sessionFull");
  });

  it("gives each player a distinct resume token", () => {
    const store = createStore();
    const session = store.createSession();

    const first = joinOrThrow(store, session, "One");
    const second = joinOrThrow(store, session, "Two");

    expect(first.player.resumeToken).not.toBe(second.player.resumeToken);
  });

  it("allocates a fresh room code when the first one collides", () => {
    const codes = ["DUPE01", "DUPE01", "UNIQUE"];
    let index = 0;
    const store = createStore({ createRoomCode: () => codes[index++] ?? "FALLBK" });

    const first = store.createSession();
    const second = store.createSession();

    expect(first.roomCode).toBe("DUPE01");
    expect(second.roomCode).toBe("UNIQUE");
    expect(store.sessionCount).toBe(2);
  });
});

describe("disconnect and reconnect", () => {
  it("preserves game state across a reconnect and keeps the same player id", () => {
    const store = createStore();
    const session = store.createSession();
    const { player } = joinOrThrow(store, session, "Grix");
    store.setReady(player.id, true);
    player.health = 42;
    player.position = { x: 7, y: 9 };

    store.markDisconnected(player.id);
    expect(player.connected).toBe(false);

    clock += GRACE_MS - 1;
    const result = store.join({
      roomCode: session.roomCode,
      playerName: "Grix",
      resumeToken: player.resumeToken,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resumed).toBe(true);
    expect(result.player.id).toBe(player.id);
    expect(result.player.health).toBe(42);
    expect(result.player.position).toEqual({ x: 7, y: 9 });
    expect(result.player.ready).toBe(true);
    expect(result.player.connected).toBe(true);
    expect(session.players.size).toBe(1);
  });

  it("refuses to resume a slot that is still connected", () => {
    const store = createStore();
    const session = store.createSession();
    const { player } = joinOrThrow(store, session, "Grix");

    const result = store.join({
      roomCode: session.roomCode,
      playerName: "Impostor",
      resumeToken: player.resumeToken,
    });

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("alreadyInSession");
  });

  it("treats an expired resume token as a brand new player", () => {
    const store = createStore();
    const session = store.createSession();
    const { player } = joinOrThrow(store, session, "Grix");
    store.markDisconnected(player.id);

    clock += GRACE_MS;
    expect(store.sweep()).toHaveLength(1);

    const result = store.join({
      roomCode: session.roomCode,
      playerName: "Grix",
      resumeToken: player.resumeToken,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resumed).toBe(false);
    expect(result.player.id).not.toBe(player.id);
    expect(result.player.health).toBe(PLAYER_MAX_HEALTH);
  });

  it("ignores a second disconnect for a player who is already disconnected", () => {
    const store = createStore();
    const session = store.createSession();
    const { player } = joinOrThrow(store, session, "Grix");

    expect(store.markDisconnected(player.id)).toBeDefined();
    clock += 10_000;
    expect(store.markDisconnected(player.id)).toBeUndefined();

    // The grace window still runs from the original drop, not the repeat.
    clock += GRACE_MS - 10_000;
    expect(store.sweep()).toHaveLength(1);
  });

  it("refreshes the display name on resume but keeps the identity", () => {
    const store = createStore();
    const session = store.createSession();
    const { player } = joinOrThrow(store, session, "Typo");
    store.markDisconnected(player.id);

    const result = store.join({
      roomCode: session.roomCode,
      playerName: "Fixed",
      resumeToken: player.resumeToken,
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.player.id).toBe(player.id);
    expect(result.player.name).toBe("Fixed");
  });
});

describe("leaving and sweeping", () => {
  it("releases a slot immediately on an explicit leave", () => {
    const store = createStore();
    const session = store.createSession();
    const { player } = joinOrThrow(store, session, "Grix");

    expect(store.leave(player.id)).toBeDefined();
    expect(session.players.size).toBe(0);
    expect(store.findMember(player.id)).toBeUndefined();
  });

  it("does not resolve a player who never joined", () => {
    const store = createStore();

    expect(store.findMember("ghost")).toBeUndefined();
    expect(store.leave("ghost")).toBeUndefined();
    expect(store.setReady("ghost", true)).toBeUndefined();
    expect(store.markDisconnected("ghost")).toBeUndefined();
  });

  it("keeps a disconnected player until the grace window elapses", () => {
    const store = createStore();
    const session = store.createSession();
    const { player } = joinOrThrow(store, session, "Grix");
    store.markDisconnected(player.id);

    clock += GRACE_MS - 1;
    expect(store.sweep()).toHaveLength(0);
    expect(session.players.size).toBe(1);

    clock += 1;
    const timedOut = store.sweep();
    expect(timedOut).toHaveLength(1);
    expect(timedOut[0]?.player.id).toBe(player.id);
    expect(session.players.size).toBe(0);
  });

  it("never times out a connected player", () => {
    const store = createStore();
    const session = store.createSession();
    joinOrThrow(store, session, "Grix");

    clock += GRACE_MS * 10;

    expect(store.sweep()).toHaveLength(0);
    expect(session.players.size).toBe(1);
  });

  it("drops an empty session once its time to live passes", () => {
    const store = createStore();
    store.createSession();

    clock += EMPTY_TTL_MS - 1;
    store.sweep();
    expect(store.sessionCount).toBe(1);

    clock += 1;
    store.sweep();
    expect(store.sessionCount).toBe(0);
  });

  it("keeps an occupied session alive past the empty time to live", () => {
    const store = createStore();
    const session = store.createSession();
    joinOrThrow(store, session, "Grix");

    clock += EMPTY_TTL_MS * 2;
    store.sweep();

    expect(store.sessionCount).toBe(1);
  });

  it("isolates players in different sessions", () => {
    const store = createStore();
    const first = store.createSession();
    const second = store.createSession();
    const alpha = joinOrThrow(store, first, "Alpha");
    joinOrThrow(store, second, "Beta");

    expect(first.players.size).toBe(1);
    expect(second.players.size).toBe(1);
    expect(store.findMember(alpha.player.id)?.session.id).toBe(first.id);
  });
});

describe("public player state", () => {
  it("omits the resume token and disconnect bookkeeping", () => {
    const store = createStore();
    const session = store.createSession();
    const { player } = joinOrThrow(store, session, "Grix");
    store.markDisconnected(player.id);

    const state = toPlayerState(player);

    expect(state).not.toHaveProperty("resumeToken");
    expect(state).not.toHaveProperty("disconnectedAt");
    expect(state.connected).toBe(false);
    expect(JSON.stringify(state)).not.toContain(player.resumeToken);
  });

  it("copies position so a caller cannot mutate authoritative state", () => {
    const store = createStore();
    const session = store.createSession();
    const { player } = joinOrThrow(store, session, "Grix");

    const state = toPlayerState(player);
    state.position.x = 999;

    expect(player.position.x).toBe(0);
  });

  it("lists every player in the session roster", () => {
    const store = createStore();
    const session = store.createSession();
    joinOrThrow(store, session, "One");
    joinOrThrow(store, session, "Two");

    expect(rosterOf(session).map((player) => player.name)).toEqual(["One", "Two"]);
  });
});
