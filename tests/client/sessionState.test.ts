import { describe, expect, it } from "vitest";
import {
  applyServerMessage,
  initialSessionView,
  othersOf,
  selfOf,
  type SessionView,
} from "../../src/client/network/sessionState.js";
import type { DungeonState, PlayerState } from "../../src/shared/types/core.js";

const SELF_ID = "8f1d6b0e-6a4a-4f2e-9d1c-2b3a4c5d6e7f";
const ALLY_ID = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

function player(id: string, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    name: id === SELF_ID ? "Self" : "Ally",
    position: { x: 0, y: 0 },
    facing: { x: 0, y: 1 },
    health: 100,
    ready: false,
    connected: true,
    inventory: [],
    ...overrides,
  };
}

function dungeon(overrides: Partial<DungeonState> = {}): DungeonState {
  return {
    map: {
      id: "ember-vault",
      name: "Ember Vault",
      width: 3,
      height: 3,
      tiles: ["###", "#.#", "###"],
    },
    monsters: [],
    loot: [],
    doors: [],
    exits: [],
    cleared: false,
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
      players: [player(SELF_ID, { health: 42 }), player(ALLY_ID)],
      dungeon: dungeon(),
    });

    expect(view.tick).toBe(7);
    expect(selfOf(view)?.health).toBe(42);
    expect(view.dungeon?.map.id).toBe("ember-vault");
  });

  it("discards a snapshot older than the one already applied", () => {
    let view = joinedView();
    view = applyServerMessage(view, {
      type: "stateSnapshot",
      tick: 7,
      players: [player(SELF_ID, { health: 42 })],
      dungeon: dungeon(),
    });
    view = applyServerMessage(view, {
      type: "stateSnapshot",
      tick: 6,
      players: [player(SELF_ID, { health: 100 })],
      dungeon: dungeon({ map: { id: "old", name: "Old", width: 1, height: 1, tiles: ["."] } }),
    });

    expect(view.tick).toBe(7);
    expect(selfOf(view)?.health).toBe(42);
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

describe("messages for later steps", () => {
  it("ignores combat and voice traffic without corrupting the view", () => {
    const view = joinedView();

    const afterAttack = applyServerMessage(view, {
      type: "attackResolved",
      attackerId: SELF_ID,
      targetId: ALLY_ID,
      damage: 3,
      targetHealth: 97,
      targetDefeated: false,
    });
    const afterVoice = applyServerMessage(afterAttack, {
      type: "voiceRangeUpdated",
      peers: [{ playerId: ALLY_ID, distance: 2, volume: 0.9 }],
    });

    expect(afterVoice).toEqual(view);
  });
});
