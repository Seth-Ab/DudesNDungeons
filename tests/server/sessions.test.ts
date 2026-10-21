import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import { PLAYER_MAX_HEALTH } from "../../src/shared/constants/game.js";
import { startRun } from "../../src/server/game/runLifecycle.js";
import {
  SessionStore,
  toOwnerPlayerState,
  toPlayerState,
  type Session,
} from "../../src/server/sessions/sessionStore.js";
import { joinRequest, testProfile, TONIC_FIELDS } from "./fixtures.js";

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
    // The authored dungeon: this file asserts on known spawn positions, which a generated run moves.
    dungeon: { dungeonId: "ember-vault" },
    ...overrides,
  });
}

/** Joins and, unless `designed` is false, designs a character so the player is in the world. */
function joinOrThrow(store: SessionStore, session: Session, playerName: string, designed = true) {
  const result = store.join(joinRequest({ roomCode: session.roomCode, playerName }));
  if (!result.ok) throw new Error(`expected join to succeed, got ${result.code}`);
  if (designed) store.setAppearance(result.player.id, DEFAULT_APPEARANCE);
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
    expect(player.carryingTorch).toBe(false);
    expect(session.location).toBe("hub");
    expect(session.dungeon.map.id).toBe("hub");
    expect(session.players.size).toBe(1);
  });

  it("refuses a fresh player while the party is in a run", () => {
    const store = createStore();
    const session = store.createSession();
    const { player } = joinOrThrow(store, session, "One");
    player.ready = true;
    expect(startRun(session, 0)).toEqual({ ok: true });

    const result = store.join(joinRequest({ roomCode: session.roomCode, playerName: "Late" }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("runInProgress");
  });

  it("does not spawn a new player on top of one who stayed", () => {
    const store = createStore();
    const session = store.createSession();
    const first = joinOrThrow(store, session, "One");
    const second = joinOrThrow(store, session, "Two");

    store.leave(first.player.id);
    const third = joinOrThrow(store, session, "Three");

    expect(third.player.position).not.toEqual(second.player.position);
  });

  it("rejects a join for a room code that does not exist", () => {
    const store = createStore();
    store.createSession();

    const result = store.join(joinRequest({ roomCode: "NOSUCH", playerName: "Grix" }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("sessionNotFound");
  });

  it("rejects a join once the party is full", () => {
    const store = createStore({ maxPartySize: 2 });
    const session = store.createSession();
    joinOrThrow(store, session, "One");
    joinOrThrow(store, session, "Two");

    const result = store.join(joinRequest({ roomCode: session.roomCode, playerName: "Three" }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("sessionFull");
  });

  it("keeps a disconnected player's slot reserved against the party limit", () => {
    const store = createStore({ maxPartySize: 2 });
    const session = store.createSession();
    const first = joinOrThrow(store, session, "One");
    joinOrThrow(store, session, "Two");
    store.markDisconnected(first.player.id);

    const result = store.join(joinRequest({ roomCode: session.roomCode, playerName: "Three" }));

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
    player.held = { id: "a0000000-0000-4000-8000-000000000001", name: "Sword", kind: "weapon", itemId: "rusted-sword", weaponKind: "melee" };

    store.markDisconnected(player.id);
    expect(player.connected).toBe(false);

    clock += GRACE_MS - 1;
    const result = store.join(joinRequest({
      roomCode: session.roomCode,
      playerName: "Grix",
      resumeToken: player.resumeToken,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resumed).toBe(true);
    expect(result.player.id).toBe(player.id);
    expect(result.player.health).toBe(42);
    expect(result.player.position).toEqual({ x: 7, y: 9 });
    expect(result.player.ready).toBe(true);
    expect(result.player.connected).toBe(true);
    expect(result.player.held).toMatchObject({ kind: "weapon", name: "Sword" });
    expect(session.players.size).toBe(1);
  });

  it("keeps provisional skill stacks across a reconnect", () => {
    const store = createStore();
    const session = store.createSession();
    const { player } = joinOrThrow(store, session, "Grix");
    player.runSkillStacks.set("iron-will", 2);

    store.markDisconnected(player.id);
    clock += GRACE_MS - 1;
    const result = store.join(joinRequest({
      roomCode: session.roomCode,
      playerName: "Grix",
      resumeToken: player.resumeToken,
    }));

    expect(result.ok && result.resumed).toBe(true);
    if (!result.ok) return;
    expect(result.player.runSkillStacks).toEqual(new Map([["iron-will", 2]]));
  });

  it("refuses to resume a slot that is still connected", () => {
    const store = createStore();
    const session = store.createSession();
    const { player } = joinOrThrow(store, session, "Grix");

    const result = store.join(joinRequest({
      roomCode: session.roomCode,
      playerName: "Impostor",
      resumeToken: player.resumeToken,
    }));

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

    const result = store.join(joinRequest({
      roomCode: session.roomCode,
      playerName: "Grix",
      resumeToken: player.resumeToken,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resumed).toBe(false);
    expect(result.player.id).not.toBe(player.id);
    expect(result.player.health).toBe(PLAYER_MAX_HEALTH);
  });

  it("refreshes the display name on resume but keeps the identity", () => {
    const store = createStore();
    const session = store.createSession();
    const { player } = joinOrThrow(store, session, "Typo");
    store.markDisconnected(player.id);

    const result = store.join(joinRequest({
      roomCode: session.roomCode,
      playerName: "Fixed",
      resumeToken: player.resumeToken,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.player.id).toBe(player.id);
    expect(result.player.name).toBe("Fixed");
  });

  it("allows a reserved player to reconnect during a run", () => {
    const store = createStore();
    const session = store.createSession();
    const { player } = joinOrThrow(store, session, "Grix");
    player.ready = true;
    expect(startRun(session, 0)).toEqual({ ok: true });
    store.markDisconnected(player.id);

    const result = store.join(joinRequest({
      roomCode: session.roomCode,
      playerName: "Grix",
      resumeToken: player.resumeToken,
    }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.resumed).toBe(true);
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

describe("appearance and party colour", () => {
  const LOOK = { body: "girl", skinTone: "olive", hairStyle: "long", hairColor: "ginger" } as const;

  it("gives a fresh slot no look and the first free party colour", () => {
    const store = createStore();
    const session = store.createSession();

    const { player } = joinOrThrow(store, session, "Grix", false);

    expect(player.appearance).toBeNull();
    expect(player.partyColor).toBe("ember");
    expect(toPlayerState(player)).toMatchObject({ appearance: null, partyColor: "ember" });
  });

  it("colours the party uniquely in join order and reuses a released colour", () => {
    const store = createStore();
    const session = store.createSession();
    const players = ["One", "Two", "Three", "Four"].map(
      (name) => joinOrThrow(store, session, name, false).player,
    );

    expect(players.map((player) => player.partyColor)).toEqual(["ember", "moss", "azure", "plum"]);

    store.leave(players[1]!.id);
    expect(joinOrThrow(store, session, "Five", false).player.partyColor).toBe("moss");

    store.markDisconnected(players[2]!.id);
    clock += GRACE_MS;
    store.sweep();
    expect(joinOrThrow(store, session, "Six", false).player.partyColor).toBe("azure");
  });

  it("refuses a join with no party colour left, whatever the configured party size", () => {
    const store = createStore({ maxPartySize: 6 });
    const session = store.createSession();
    for (const name of ["One", "Two", "Three", "Four"]) joinOrThrow(store, session, name, false);

    const result = store.join(joinRequest({ roomCode: session.roomCode, playerName: "Five" }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("sessionFull");
  });

  it("stores a look once and locks it", () => {
    const store = createStore();
    const session = store.createSession();
    const { player } = joinOrThrow(store, session, "Grix", false);

    const first = store.setAppearance(player.id, LOOK);
    expect(first.ok).toBe(true);
    expect(player.appearance).toEqual(LOOK);
    expect(toPlayerState(player).appearance).toEqual(LOOK);

    const second = store.setAppearance(player.id, { ...LOOK, hairColor: "black" });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.code).toBe("appearanceLocked");
    expect(player.appearance).toEqual(LOOK);
  });

  it("refuses a look from a player who is not in a session", () => {
    const store = createStore();

    const result = store.setAppearance("player-nobody", LOOK);

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe("notInSession");
  });

  it("keeps the look and colour through a reconnect", () => {
    const store = createStore();
    const session = store.createSession();
    joinOrThrow(store, session, "First");
    const { player } = joinOrThrow(store, session, "Grix", false);
    store.setAppearance(player.id, LOOK);

    store.markDisconnected(player.id);
    clock += GRACE_MS - 1;
    const result = store.join(
      joinRequest({ roomCode: session.roomCode, playerName: "Grix", resumeToken: player.resumeToken }),
    );

    expect(result.ok && result.resumed).toBe(true);
    if (!result.ok) return;
    expect(result.player.appearance).toEqual(LOOK);
    expect(result.player.partyColor).toBe("moss");
  });

  it("holds a designing slot for the grace window, still without a look, then releases it", () => {
    const store = createStore();
    const session = store.createSession();
    const { player } = joinOrThrow(store, session, "Grix", false);

    store.markDisconnected(player.id);
    clock += GRACE_MS - 1;
    expect(store.sweep()).toEqual([]);
    const resumed = store.join(
      joinRequest({ roomCode: session.roomCode, playerName: "Grix", resumeToken: player.resumeToken }),
    );
    expect(resumed.ok && resumed.resumed).toBe(true);
    if (!resumed.ok) return;
    expect(resumed.player.appearance).toBeNull();
    expect(resumed.player.partyColor).toBe("ember");

    store.markDisconnected(player.id);
    clock += GRACE_MS;
    expect(store.sweep().map((member) => member.player.id)).toEqual([player.id]);
    expect(session.players.size).toBe(0);
  });

  it("lets a designing player block nobody, then spawns them on free ground", () => {
    const store = createStore();
    const session = store.createSession();
    const designing = joinOrThrow(store, session, "Designing", false).player;
    const spawned = joinOrThrow(store, session, "Spawned").player;

    // A player still designing blocks nobody, so the next arrival is offered the same spawn point.
    expect(spawned.position).toEqual(designing.position);

    store.setAppearance(designing.id, LOOK);
    expect(designing.position).not.toEqual(spawned.position);
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
    const originalX = player.position.x;

    const state = toPlayerState(player);
    state.position.x = 999;

    expect(player.position.x).toBe(originalX);
  });
});

describe("joining with a profile", () => {
  const TONIC = { id: "44444444-4444-4444-8444-444444444444", name: "Minor Tonic", ...TONIC_FIELDS };

  it("plays a recognised profile rather than minting a new one", () => {
    const store = createStore();
    const session = store.createSession();
    const profile = testProfile("returning", { bankedItems: [TONIC] });

    const result = store.join(joinRequest({
      roomCode: session.roomCode,
      playerName: "Grix",
      profile,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.player.profile).toBe(profile);
    // The bank is owner data: public state omits it and the owner's own state carries it.
    expect(toPlayerState(result.player)).not.toHaveProperty("bankedItems");
    expect(toOwnerPlayerState(result.player).bankedItems).toEqual([TONIC]);
  });

  it("creates a profile only once the join has otherwise succeeded", () => {
    const store = createStore();
    let created = 0;

    const result = store.join(joinRequest({
      roomCode: "NOSUCH",
      playerName: "Grix",
      createProfile: () => {
        created += 1;
        return testProfile("Grix");
      },
    }));

    expect(result.ok).toBe(false);
    // A mistyped room code must not leave an empty profile behind for as long as the server lives.
    expect(created).toBe(0);
  });

  it("refuses a profile that is already playing somewhere", () => {
    const store = createStore();
    const first = store.createSession();
    const second = store.createSession();
    const profile = testProfile("shared");

    store.join(joinRequest({ roomCode: first.roomCode, playerName: "Grix", profile }));
    const result = store.join(joinRequest({
      roomCode: second.roomCode,
      playerName: "Grix",
      profile,
    }));

    // One bank cannot be spent by two parties at once, so the second join is refused outright.
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.code).toBe("profileInUse");
  });

  it("still lets that profile reconnect to the slot it already holds", () => {
    const store = createStore();
    const session = store.createSession();
    const profile = testProfile("reconnecting");
    const joined = store.join(joinRequest({
      roomCode: session.roomCode,
      playerName: "Grix",
      profile,
    }));
    if (!joined.ok) throw new Error("expected the first join to succeed");

    store.markDisconnected(joined.player.id);
    // The slot still holds this profile, which is exactly what the in-use check would refuse; the
    // resume token has to be read first or a refresh would lock a player out of their own party.
    const result = store.join(joinRequest({
      roomCode: session.roomCode,
      playerName: "Grix",
      profile,
      resumeToken: joined.player.resumeToken,
    }));

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.resumed).toBe(true);
    expect(result.player.id).toBe(joined.player.id);
  });

  it("frees the profile once the player leaves", () => {
    const store = createStore();
    const session = store.createSession();
    const profile = testProfile("departing");
    const joined = store.join(joinRequest({
      roomCode: session.roomCode,
      playerName: "Grix",
      profile,
    }));
    if (!joined.ok) throw new Error("expected the first join to succeed");

    store.leave(joined.player.id);
    const result = store.join(joinRequest({
      roomCode: session.roomCode,
      playerName: "Grix",
      profile,
    }));

    expect(result.ok).toBe(true);
  });
});
