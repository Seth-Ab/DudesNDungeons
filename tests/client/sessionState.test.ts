import { describe, expect, it } from "vitest";
import {
  applyServerMessage,
  initialSessionView,
  inParty,
  othersOf,
  selfOf,
  type SessionView,
} from "../../src/client/network/sessionState.js";
import type { DungeonSnapshot, PlayerState, RunState } from "../../src/shared/types/core.js";

const SELF_ID = "8f1d6b0e-6a4a-4f2e-9d1c-2b3a4c5d6e7f";
const ALLY_ID = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

function player(id: string, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    name: id === SELF_ID ? "Self" : "Ally",
    position: { x: 0, y: 0 },
    facing: { x: 0, y: 1 },
    health: 100,
    resistance: 40,
    stamina: 100,
    ready: false,
    connected: true,
    inventory: [],
    carryingTorch: false,
    carryingPlayerId: null,
    carriedByPlayerId: null,
    bankedItems: [],
    ...overrides,
  };
}

/** A run clock a minute into an untimed dungeon: nothing decaying yet. */
function run(): RunState {
  return { elapsedMs: 60_000, decayStartsInMs: 540_000, decaying: false, decayPerSecond: 0 };
}

function dungeon(overrides: Partial<DungeonSnapshot> = {}): DungeonSnapshot {
  return {
    map: {
      id: "ember-vault",
      name: "Ember Vault",
      width: 3,
      height: 3,
      reset: true,
      discovered: [
        { x: 0, y: 0, tiles: "###" },
        { x: 0, y: 1, tiles: "#.#" },
        { x: 0, y: 2, tiles: "###" },
      ],
    },
    rooms: [],
    monsters: [],
    loot: [],
    traps: [],
    puzzles: [],
    doors: [],
    exits: [],
    lightSources: [],
    ...overrides,
  };
}

function joinedView(): SessionView {
  return applyServerMessage(initialSessionView, {
    type: "sessionJoined",
    sessionId: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
    roomCode: "BCDFGH",
    playerId: SELF_ID,
    resumeToken: "0123456789abcdef0123456789abcdef",
    resumed: false,
    tickRate: 20,
    players: [player(SELF_ID)],
    profile: {
      id: "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f",
      displayName: "Self",
      bankedItems: [],
      unlockedSkillIds: [],
      unlockedUpgradeIds: [],
      runsEscaped: 0,
      runsLost: 0,
    },
    profileSecret: null,
  });
}

describe("joining", () => {
  it("adopts identity, room, and roster from sessionJoined", () => {
    const view = joinedView();

    expect(view.phase).toBe("inSession");
    expect(view.selfId).toBe(SELF_ID);
    expect(view.roomCode).toBe("BCDFGH");
    expect(view.tickRate).toBe(20);
    expect(view.players).toHaveLength(1);
  });

  it("separates self from the rest of the party", () => {
    let view = joinedView();
    view = applyServerMessage(view, { type: "playerJoined", player: player(ALLY_ID) });

    expect(selfOf(view)?.id).toBe(SELF_ID);
    expect(othersOf(view).map((p) => p.id)).toEqual([ALLY_ID]);
  });

  it("ignores a duplicate playerJoined", () => {
    let view = joinedView();
    view = applyServerMessage(view, { type: "playerJoined", player: player(ALLY_ID) });
    view = applyServerMessage(view, { type: "playerJoined", player: player(ALLY_ID) });

    expect(view.players).toHaveLength(2);
  });
});

describe("party changes", () => {
  it("removes a player who left", () => {
    let view = joinedView();
    view = applyServerMessage(view, { type: "playerJoined", player: player(ALLY_ID) });
    view = applyServerMessage(view, { type: "playerLeft", playerId: ALLY_ID, reason: "left" });

    expect(view.players.map((p) => p.id)).toEqual([SELF_ID]);
  });

  it("keeps a dropped player in the roster and only marks them disconnected", () => {
    let view = joinedView();
    view = applyServerMessage(view, { type: "playerJoined", player: player(ALLY_ID) });
    view = applyServerMessage(view, {
      type: "playerConnectionChanged",
      playerId: ALLY_ID,
      connected: false,
    });

    expect(view.players).toHaveLength(2);
    expect(view.players.find((p) => p.id === ALLY_ID)?.connected).toBe(false);
  });

  it("applies a ready change to one player only", () => {
    let view = joinedView();
    view = applyServerMessage(view, { type: "playerJoined", player: player(ALLY_ID) });
    view = applyServerMessage(view, {
      type: "playerReadyChanged",
      playerId: ALLY_ID,
      ready: true,
    });

    expect(view.players.find((p) => p.id === ALLY_ID)?.ready).toBe(true);
    expect(view.players.find((p) => p.id === SELF_ID)?.ready).toBe(false);
  });

  it("ignores an update for a player it does not know", () => {
    const view = joinedView();
    const after = applyServerMessage(view, {
      type: "playerReadyChanged",
      playerId: ALLY_ID,
      ready: true,
    });

    expect(after.players).toEqual(view.players);
  });
});

describe("snapshots", () => {
  it("replaces the roster and advances the tick", () => {
    let view = joinedView();
    view = applyServerMessage(view, {
      type: "stateSnapshot",
      tick: 7,
      location: "dungeon",
      players: [player(SELF_ID, { health: 42 }), player(ALLY_ID)],
      dungeon: dungeon(),
      run: run(),
    });

    expect(view.tick).toBe(7);
    expect(selfOf(view)?.health).toBe(42);
    expect(view.dungeon?.map.id).toBe("ember-vault");
  });

  it("adopts the run clock, which the HUD needs to warn before resistance falls", () => {
    let view = joinedView();
    expect(view.run).toBeNull();

    view = applyServerMessage(view, {
      type: "stateSnapshot",
      tick: 1,
      location: "dungeon",
      players: [player(SELF_ID, { resistance: 12, stamina: 30 })],
      dungeon: dungeon(),
      run: { elapsedMs: 601_000, decayStartsInMs: 0, decaying: true, decayPerSecond: 0.1 },
    });

    expect(view.run).toEqual({
      elapsedMs: 601_000,
      decayStartsInMs: 0,
      decaying: true,
      decayPerSecond: 0.1,
    });
    expect(selfOf(view)).toMatchObject({ resistance: 12, stamina: 30 });
  });

  it("discards a snapshot older than the one already applied", () => {
    let view = joinedView();
    view = applyServerMessage(view, {
      type: "stateSnapshot",
      tick: 7,
      location: "dungeon",
      players: [player(SELF_ID, { health: 42 })],
      dungeon: dungeon(),
      run: run(),
    });
    view = applyServerMessage(view, {
      type: "stateSnapshot",
      tick: 6,
      location: "dungeon",
      players: [player(SELF_ID, { health: 100 })],
      dungeon: dungeon({
        map: { id: "old", name: "Old", width: 1, height: 1, reset: true, discovered: [] },
      }),
      run: run(),
    });

    expect(view.tick).toBe(7);
    expect(selfOf(view)?.health).toBe(42);
  });
});

describe("map discovery in snapshots", () => {
  function withMap(tick: number, map: DungeonSnapshot["map"], view: SessionView): SessionView {
    return applyServerMessage(view, {
      type: "stateSnapshot",
      tick,
      location: "dungeon",
      players: [player(SELF_ID)],
      dungeon: dungeon({ map }),
      run: run(),
    });
  }

  const base = { id: "w", name: "W", width: 4, height: 1 };

  it("accumulates geometry across snapshots", () => {
    let view = withMap(1, { ...base, reset: true, discovered: [{ x: 0, y: 0, tiles: "#." }] }, joinedView());
    view = withMap(2, { ...base, reset: false, discovered: [{ x: 2, y: 0, tiles: ".#" }] }, view);

    expect(view.dungeon?.map.tiles).toEqual(["#..#"]);
  });

  it("keeps the same map object across snapshots that discover nothing", () => {
    let view = withMap(1, { ...base, reset: true, discovered: [{ x: 0, y: 0, tiles: "#" }] }, joinedView());
    const held = view.dungeon?.map;
    view = withMap(2, { ...base, reset: false, discovered: [] }, view);

    expect(view.dungeon?.map).toBe(held);
  });

  it("still folds in the geometry of a stale snapshot, which the server will not resend", () => {
    let view = withMap(5, { ...base, reset: true, discovered: [{ x: 0, y: 0, tiles: "#" }] }, joinedView());
    view = withMap(5, { ...base, reset: false, discovered: [{ x: 1, y: 0, tiles: "." }] }, view);

    expect(view.tick).toBe(5);
    expect(view.dungeon?.map.tiles).toEqual(["#.  "]);
  });

  it("drops the old world's geometry when a reset arrives for a new one", () => {
    let view = withMap(1, { ...base, reset: true, discovered: [{ x: 0, y: 0, tiles: "####" }] }, joinedView());
    view = withMap(2, { id: "v", name: "V", width: 2, height: 1, reset: true, discovered: [{ x: 1, y: 0, tiles: "." }] }, view);

    expect(view.dungeon?.map).toMatchObject({ id: "v", tiles: [" ."] });
  });
});

describe("the run lifecycle", () => {
  const key = { id: "a1111111-1111-4111-8111-111111111111", name: "Copper Key", kind: "key" } as const;

  function snapshot(view: SessionView, tick: number, location: "hub" | "dungeon", self: PlayerState) {
    return applyServerMessage(view, {
      type: "stateSnapshot",
      tick,
      location,
      players: [self],
      dungeon: dungeon(),
      run: run(),
    });
  }

  it("reports no outcome for the first snapshot, which is nobody's run ending", () => {
    const view = snapshot(joinedView(), 1, "hub", player(SELF_ID));

    expect(view.location).toBe("hub");
    expect(view.runOutcome).toBeNull();
  });

  it("announces the run and clears the last outcome when the party leaves the hub", () => {
    let view = snapshot(joinedView(), 1, "hub", player(SELF_ID));
    view = snapshot(view, 2, "dungeon", player(SELF_ID));

    expect(view.lastAction).toBe("The run has begun.");
    expect(view.runOutcome).toBeNull();
  });

  it("counts what the player banked when the party returns to the hub", () => {
    let view = snapshot(joinedView(), 1, "hub", player(SELF_ID));
    view = snapshot(view, 2, "dungeon", player(SELF_ID, { inventory: [key] }));
    view = snapshot(view, 3, "hub", player(SELF_ID, { bankedItems: [key] }));

    expect(view.runOutcome).toEqual({ kind: "escaped", banked: 1 });
  });

  // The server heals everyone on the way back to the hub, so the snapshot after the transition
  // cannot say who was standing. Only the one before it can, which is why this is read here.
  it("reports the loss of a player who was down when the run ended", () => {
    let view = snapshot(joinedView(), 1, "hub", player(SELF_ID));
    view = snapshot(view, 2, "dungeon", player(SELF_ID, { health: 0, inventory: [key] }));
    view = snapshot(view, 3, "hub", player(SELF_ID, { health: 100 }));

    expect(view.runOutcome).toEqual({ kind: "lost", banked: 0 });
  });

  it("keeps the outcome up across later snapshots in the hub", () => {
    let view = snapshot(joinedView(), 1, "hub", player(SELF_ID));
    view = snapshot(view, 2, "dungeon", player(SELF_ID));
    view = snapshot(view, 3, "hub", player(SELF_ID, { bankedItems: [key] }));
    view = snapshot(view, 4, "hub", player(SELF_ID, { bankedItems: [key] }));

    expect(view.runOutcome).toEqual({ kind: "escaped", banked: 1 });
  });

  it("puts a refusal in words rather than passing the server's reason through", () => {
    const view = applyServerMessage(joinedView(), {
      type: "actionRejected",
      sequence: 4,
      reason: "exhausted",
    });

    expect(view.lastAction).toBe("Not enough stamina.");
  });

  it("counts stamina refusals, and only those", () => {
    const refuse = (view: SessionView, reason: "exhausted" | "blocked") =>
      applyServerMessage(view, { type: "actionRejected", sequence: null, reason });

    let view = refuse(joinedView(), "exhausted");
    view = refuse(view, "exhausted");
    view = refuse(view, "blocked");

    expect(view.staminaRefusals).toBe(2);
  });
});

describe("errors", () => {
  it("returns to connected after a rejected join so the code can be retyped", () => {
    let view = applyServerMessage({ ...initialSessionView, phase: "joining" }, {
      type: "sessionError",
      code: "sessionNotFound",
      message: "No dungeon exists for that room code",
    });

    expect(view.phase).toBe("connected");
    expect(view.lastError?.code).toBe("sessionNotFound");

    view = applyServerMessage(view, {
      type: "sessionError",
      code: "sessionFull",
      message: "This dungeon is full",
    });
    expect(view.phase).toBe("connected");
  });

  it("leaves the phase alone for an error that does not end a join", () => {
    const view = applyServerMessage({ ...joinedView(), phase: "inSession" }, {
      type: "sessionError",
      code: "notImplemented",
      message: "not handled yet",
    });

    expect(view.phase).toBe("inSession");
    expect(view.lastError?.code).toBe("notImplemented");
  });
});

describe("action feedback", () => {
  it("records combat and action feedback without inventing state", () => {
    const view = joinedView();

    const afterAttack = applyServerMessage(view, {
      type: "attackResolved",
      attackerId: SELF_ID,
      targetId: ALLY_ID,
      damage: 3,
      targetHealth: 97,
      targetDefeated: false,
    });
    const afterRejection = applyServerMessage(afterAttack, {
      type: "actionRejected",
      sequence: null,
      reason: "outOfRange",
    });

    expect(afterAttack.lastAction).toBe("Hit target for 3");
    expect(afterRejection.lastAction).toBe("Too far away.");
    expect(afterRejection.players).toEqual(view.players);
  });
});

describe("voice", () => {
  it("keeps the latest proximity update, replacing rather than merging", () => {
    const view = joinedView();
    expect(view.voiceRange).toEqual([]);

    const inRange = applyServerMessage(view, {
      type: "voiceRangeUpdated",
      peers: [{ playerId: ALLY_ID, distance: 2, volume: 0.9 }],
    });
    expect(inRange.voiceRange).toEqual([{ playerId: ALLY_ID, distance: 2, volume: 0.9 }]);
    expect(inRange.players).toBe(view.players);

    // An ally the next update leaves out is gone from the range, so the mesh silences them.
    const outOfSight = applyServerMessage(inRange, { type: "voiceRangeUpdated", peers: [] });
    expect(outOfSight.voiceRange).toEqual([]);
  });

  it("leaves a relayed handshake out of the view", () => {
    const view = joinedView();
    const after = applyServerMessage(view, {
      type: "voiceSignalRelay",
      fromPlayerId: ALLY_ID,
      signal: { kind: "offer", sdp: "v=0" },
    });
    expect(after).toBe(view);
  });
});

describe("inParty", () => {
  const at = (phase: SessionView["phase"], lastError: SessionView["lastError"] = null) => ({
    ...joinedView(),
    phase,
    lastError,
  });

  it("holds through a reconnect", () => {
    expect(inParty(at("inSession"))).toBe(true);
    expect(inParty(at("reconnecting"))).toBe(true);
    expect(inParty(at("connecting"))).toBe(true);
    expect(inParty(at("connected"))).toBe(true);
    expect(inParty(at("joining"))).toBe(true);
    // A stale non-join error does not end the party.
    expect(inParty(at("connected", { code: "rateLimited", message: "slow down" }))).toBe(true);
  });

  it("ends on leaving, a closed reconnect window, or a refused rejoin", () => {
    expect(inParty(at("offline"))).toBe(false);
    expect(inParty(at("failed"))).toBe(false);
    expect(inParty(at("connected", { code: "sessionNotFound", message: "gone" }))).toBe(false);
  });
});

describe("progression", () => {
  const catalog = {
    type: "progressionCatalog" as const,
    skills: [
      {
        id: "iron-will",
        name: "Iron Will",
        description: "Start with more resistance.",
        effects: [{ type: "resistanceBonus" as const, amount: 10 }],
      },
    ],
    upgrades: [],
  };
  const update = (overrides: Record<string, string[]> = {}) => ({
    type: "progressionUpdated" as const,
    unlockedSkillIds: [],
    unlockedUpgradeIds: [],
    runSkillIds: [],
    activeSkillIds: [],
    activeUpgradeIds: [],
    ...overrides,
  });

  it("holds nothing before the server sends it", () => {
    expect(joinedView().progression).toBeNull();
  });

  it("keeps the catalog and the initial state", () => {
    let view = applyServerMessage(joinedView(), catalog);
    view = applyServerMessage(view, update());

    expect(view.progression?.skills.map((skill) => skill.id)).toEqual(["iron-will"]);
    expect(view.progression?.activeSkillIds).toEqual([]);
  });

  it("tells a provisional skill from a permanent one, then banks it on extraction", () => {
    let view = applyServerMessage(joinedView(), catalog);
    view = applyServerMessage(
      view,
      update({ runSkillIds: ["iron-will"], activeSkillIds: ["iron-will"] }),
    );
    expect(view.progression?.runSkillIds).toEqual(["iron-will"]);
    expect(view.progression?.unlockedSkillIds).toEqual([]);

    view = applyServerMessage(
      view,
      update({ unlockedSkillIds: ["iron-will"], activeSkillIds: ["iron-will"] }),
    );
    expect(view.progression?.runSkillIds).toEqual([]);
    expect(view.progression?.unlockedSkillIds).toEqual(["iron-will"]);
    // An update replaces state but never the catalog it describes.
    expect(view.progression?.skills).toHaveLength(1);
  });

  it("clears a provisional skill on loss", () => {
    let view = applyServerMessage(joinedView(), catalog);
    view = applyServerMessage(
      view,
      update({ runSkillIds: ["iron-will"], activeSkillIds: ["iron-will"] }),
    );
    view = applyServerMessage(view, update());

    expect(view.progression?.runSkillIds).toEqual([]);
    expect(view.progression?.activeSkillIds).toEqual([]);
  });

  it("resets on a fresh join so a new profile never inherits the last one's", () => {
    const view = applyServerMessage(
      applyServerMessage(joinedView(), catalog),
      update({ unlockedSkillIds: ["iron-will"] }),
    );
    const rejoined = applyServerMessage(view, {
      type: "sessionJoined",
      sessionId: "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f",
      roomCode: "BCDFGH",
      playerId: SELF_ID,
      resumeToken: "0123456789abcdef0123456789abcdef",
      resumed: true,
      tickRate: 20,
      players: [player(SELF_ID)],
      profile: {
        id: "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f",
        displayName: "Self",
        bankedItems: [],
        unlockedSkillIds: [],
        unlockedUpgradeIds: [],
        runsEscaped: 0,
        runsLost: 0,
      },
      profileSecret: null,
    });

    expect(rejoined.progression).toBeNull();
  });
});
