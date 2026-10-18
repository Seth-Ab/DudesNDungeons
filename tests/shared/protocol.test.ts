import { describe, expect, it } from "vitest";
import {
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_CLIENT_MESSAGE_CHARS,
  MAX_PLAYER_NAME_LENGTH,
  MAX_VOICE_SIGNAL_LENGTH,
  PROTOCOL_VERSION,
} from "../../src/shared/constants/game.js";
import {
  parseClientMessage,
  parseServerMessage,
  serializeServerMessage,
  type ServerMessage,
} from "../../src/shared/protocol/index.js";

const PLAYER_ID = "8f1d6b0e-6a4a-4f2e-9d1c-2b3a4c5d6e7f";
const TARGET_ID = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";
const SESSION_ID = "3c4d5e6f-7a8b-4c9d-8e0f-1a2b3c4d5e6f";
const RESUME_TOKEN = "0123456789abcdef0123456789abcdef";
const PROFILE_ID = "5d6e7f80-9a1b-4c2d-8e3f-4a5b6c7d8e9f";

describe("parseClientMessage", () => {
  it("accepts a well-formed joinSession message", () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: "joinSession",
        protocolVersion: PROTOCOL_VERSION,
        roomCode: "BCDFGH",
        playerName: "Grix",
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message.type).toBe("joinSession");
    }
  });

  it("accepts a movement intent carrying a direction", () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: "playerMoveIntent",
        sequence: 12,
        direction: { x: 0.5, y: -1 },
      }),
    );

    expect(result.ok).toBe(true);
  });

  it("rejects payloads that are not valid JSON", () => {
    const result = parseClientMessage("{not json");

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/valid JSON/);
    }
  });

  it("rejects an unknown message type", () => {
    const result = parseClientMessage(JSON.stringify({ type: "teleportToBoss" }));

    expect(result.ok).toBe(false);
  });

  it("rejects a message missing required fields", () => {
    const result = parseClientMessage(
      JSON.stringify({ type: "joinSession", roomCode: "BCDFGH" }),
    );

    expect(result.ok).toBe(false);
  });

  it("rejects a room code using excluded characters", () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: "joinSession",
        protocolVersion: PROTOCOL_VERSION,
        roomCode: "AEIOU0",
        playerName: "Grix",
      }),
    );

    expect(result.ok).toBe(false);
  });

  it("accepts swapHeld with an item id or null, and rejects anything else", () => {
    const itemId = "a1111111-1111-4111-8111-111111111111";

    expect(parseClientMessage(JSON.stringify({ type: "swapHeld", itemId })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: "swapHeld", itemId: null })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: "swapHeld" })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: "swapHeld", itemId: "nope" })).ok).toBe(false);
  });

  it("accepts dropItem and giveItem, and rejects malformed ones", () => {
    const itemId = "a1111111-1111-4111-8111-111111111111";
    const targetPlayerId = "9a2e7c1f-7b5b-4a3f-8e2d-3c4b5d6e7f80";

    expect(parseClientMessage(JSON.stringify({ type: "dropItem", itemId })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: "giveItem", itemId, targetPlayerId })).ok).toBe(
      true,
    );
    expect(parseClientMessage(JSON.stringify({ type: "dropItem", itemId: "nope" })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: "giveItem", itemId })).ok).toBe(false);
    expect(
      parseClientMessage(JSON.stringify({ type: "giveItem", itemId, targetPlayerId: "x" })).ok,
    ).toBe(false);
  });

  it("rejects an overlong player name", () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: "joinSession",
        protocolVersion: PROTOCOL_VERSION,
        roomCode: "BCDFGH",
        playerName: "x".repeat(MAX_PLAYER_NAME_LENGTH + 1),
      }),
    );

    expect(result.ok).toBe(false);
  });

  it("accepts a joinSession carrying a resume token", () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: "joinSession",
        protocolVersion: PROTOCOL_VERSION,
        roomCode: "BCDFGH",
        playerName: "Grix",
        resumeToken: RESUME_TOKEN,
      }),
    );

    expect(result.ok).toBe(true);
    if (result.ok && result.message.type === "joinSession") {
      expect(result.message.resumeToken).toBe(RESUME_TOKEN);
    }
  });

  it("rejects a resume token that is not the expected hex shape", () => {
    for (const resumeToken of [RESUME_TOKEN.toUpperCase(), RESUME_TOKEN.slice(1), "zz"]) {
      const result = parseClientMessage(
        JSON.stringify({
          type: "joinSession",
          protocolVersion: PROTOCOL_VERSION,
          roomCode: "BCDFGH",
          playerName: "Grix",
          resumeToken,
        }),
      );

      expect(result.ok).toBe(false);
    }
  });

  it("rejects non-finite movement components", () => {
    const result = parseClientMessage(
      '{"type":"playerMoveIntent","sequence":1,"direction":{"x":1e999,"y":0}}',
    );

    expect(result.ok).toBe(false);
  });

  it("rejects a message larger than the size cap before parsing it", () => {
    const oversized = JSON.stringify({
      type: "voiceSignal",
      targetPlayerId: PLAYER_ID,
      signal: { kind: "offer", sdp: "x".repeat(MAX_CLIENT_MESSAGE_CHARS) },
    });

    const result = parseClientMessage(oversized);

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toMatch(/maximum allowed size/);
    }
  });

  it("fits the largest valid join and voice frames inside the transport byte limit", () => {
    // Three-byte characters in every free-text field: the worst case for UTF-8 size.
    const frames = [
      JSON.stringify({
        type: "joinSession",
        protocolVersion: PROTOCOL_VERSION,
        roomCode: "BCDFGH",
        playerName: "€".repeat(MAX_PLAYER_NAME_LENGTH),
        resumeToken: RESUME_TOKEN,
        profileSecret: RESUME_TOKEN,
      }),
      JSON.stringify({
        type: "voiceSignal",
        targetPlayerId: PLAYER_ID,
        signal: { kind: "answer", sdp: "€".repeat(MAX_VOICE_SIGNAL_LENGTH) },
      }),
      JSON.stringify({
        type: "voiceSignal",
        targetPlayerId: PLAYER_ID,
        signal: {
          kind: "iceCandidate",
          candidate: "€".repeat(MAX_VOICE_SIGNAL_LENGTH),
          sdpMid: "€".repeat(256),
          sdpMLineIndex: 0,
        },
      }),
    ];

    for (const frame of frames) {
      expect(parseClientMessage(frame).ok).toBe(true);
      expect(Buffer.byteLength(frame)).toBeLessThanOrEqual(MAX_CLIENT_MESSAGE_BYTES);
    }
  });

  it("rejects a voice signal of an unknown kind", () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: "voiceSignal",
        targetPlayerId: PLAYER_ID,
        signal: { kind: "renegotiate", sdp: "v=0" },
      }),
    );

    expect(result.ok).toBe(false);
  });

  it("rejects a target id that is not a uuid", () => {
    const result = parseClientMessage(
      JSON.stringify({ type: "playerInteract", targetId: "door-1" }),
    );

    expect(result.ok).toBe(false);
  });
});

describe("parseServerMessage", () => {
  it("round-trips a serialized server message", () => {
    const message: ServerMessage = {
      type: "voiceRangeUpdated",
      peers: [{ playerId: PLAYER_ID, distance: 4.25, volume: 0.6 }],
    };

    const result = parseServerMessage(serializeServerMessage(message));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toEqual(message);
    }
  });

  it("round-trips a sessionJoined carrying the resume token and the profile", () => {
    const message: ServerMessage = {
      type: "sessionJoined",
      sessionId: SESSION_ID,
      roomCode: "BCDFGH",
      playerId: PLAYER_ID,
      resumeToken: RESUME_TOKEN,
      resumed: true,
      tickRate: 20,
      players: [],
      profile: {
        id: PROFILE_ID,
        displayName: "Grix",
        bankedItems: [],
        unlockedSkillIds: ["iron-will"],
        unlockedUpgradeIds: [],
        runsEscaped: 2,
        runsLost: 1,
      },
      // A rejoin, so the server issues nothing and the client keeps the secret it already has.
      profileSecret: null,
    };

    const result = parseServerMessage(serializeServerMessage(message));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toEqual(message);
    }
  });

  it("round-trips the progression catalog and an owner's progression state", () => {
    const catalog: ServerMessage = {
      type: "progressionCatalog",
      skills: [
        {
          id: "iron-will",
          name: "Iron Will",
          description: "Start with more resistance.",
          effects: [{ type: "resistanceBonus", amount: 10 }],
        },
      ],
      upgrades: [
        {
          id: "iron-will-steeled",
          skillId: "iron-will",
          name: "Steeled",
          description: "More resistance.",
          tier: 1,
          requires: [],
          effects: [{ type: "resistanceBonus", amount: 5 }],
        },
      ],
    };
    const state: ServerMessage = {
      type: "progressionUpdated",
      unlockedSkillIds: ["iron-will"],
      unlockedUpgradeIds: [],
      runSkillIds: ["torchbearer"],
      activeSkillIds: ["iron-will", "torchbearer"],
      activeUpgradeIds: [],
    };

    for (const message of [catalog, state]) {
      const result = parseServerMessage(serializeServerMessage(message));
      expect(result.ok && result.message).toEqual(message);
    }
  });

  it("rejects progression state with a malformed id or an unknown effect", () => {
    const badId = parseServerMessage(
      JSON.stringify({
        type: "progressionUpdated",
        unlockedSkillIds: ["Not A Slug"],
        unlockedUpgradeIds: [],
        runSkillIds: [],
        activeSkillIds: [],
        activeUpgradeIds: [],
      }),
    );
    const badEffect = parseServerMessage(
      JSON.stringify({
        type: "progressionCatalog",
        skills: [
          { id: "x", name: "X", description: "d", effects: [{ type: "godMode", amount: 1 }] },
        ],
        upgrades: [],
      }),
    );

    expect(badId.ok).toBe(false);
    expect(badEffect.ok).toBe(false);
  });

  it("round-trips a snapshot with server-owned dungeon state", () => {
    const message: ServerMessage = {
      type: "stateSnapshot",
      tick: 3,
      location: "dungeon",
      players: [],
      dungeon: {
        map: {
          id: "ember-vault",
          name: "Ember Vault",
          width: 3,
          height: 3,
          reset: true,
          discovered: [
            { x: 0, y: 0, tiles: "###" },
            { x: 0, y: 1, tiles: "#.#" },
          ],
          lit: [[1, 1, 1]],
        },
        rooms: [
          {
            id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
            name: "Ember Hall",
            kind: "hall",
            x: 0,
            y: 0,
            width: 3,
            height: 3,
          },
        ],
        monsters: [
          {
            id: TARGET_ID,
            typeId: "ash-imp",
            name: "Ash Imp",
            position: { x: 1, y: 1 },
            health: 12,
            maxHealth: 12,
            alive: true,
            boss: false,
            action: "idle",
            behavior: "melee",
            windupProgress: 0,
            facing: { x: 0, y: 1 },
            hitRange: 1,
            hitArcCos: 0.5,
          },
        ],
        projectiles: [],
        loot: [
          {
            id: SESSION_ID,
            name: "Copper Key",
            kind: "key",
            position: { x: 1, y: 1 },
            pickedUp: false,
          },
        ],
        chests: [
          {
            id: "99999999-9999-4999-8999-999999999999",
            lootTableId: "common-chest",
            position: { x: 2, y: 1 },
            opened: false,
            locked: true,
          },
        ],
        traps: [],
        puzzles: [],
        doors: [],
        exits: [
          {
            id: "88888888-8888-4888-8888-888888888888",
            position: { x: 1, y: 1 },
            destination: "hub",
            sealed: true,
          },
        ],
        lightSources: [
          {
            id: "77777777-7777-4777-8777-777777777777",
            name: "Torch Pillar",
            kind: "fixed",
            position: { x: 1, y: 1 },
            radius: 3.2,
          },
        ],
      },
      run: { elapsedMs: 1_000, decayStartsInMs: 599_000, decaying: false, decayPerSecond: 0 },
    };

    const result = parseServerMessage(serializeServerMessage(message));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toEqual(message);
    }
  });

  it("rejects a snapshot whose lit runs are malformed", () => {
    const snapshotWithLit = (lit: unknown) =>
      JSON.stringify({
        type: "stateSnapshot",
        tick: 1,
        location: "dungeon",
        players: [],
        dungeon: {
          map: { id: "w", name: "W", width: 4, height: 4, reset: false, discovered: [], lit },
          rooms: [],
          monsters: [],
          projectiles: [],
          loot: [],
          chests: [],
          doors: [],
          exits: [],
          traps: [],
          puzzles: [],
          lightSources: [],
        },
        run: { elapsedMs: 0, decayStartsInMs: 1000, decaying: false, decayPerSecond: 0 },
      });

    expect(parseServerMessage(snapshotWithLit([[0, 0, 2]])).ok).toBe(true);
    for (const lit of [
      [[-1, 0, 2]],
      [[0, 0, 0]],
      [[0, 0.5, 2]],
      [[0, 0]],
      [[0, 0, 2, 9]],
      [{ x: 0, y: 0, length: 2 }],
      "0,0,2",
      undefined,
    ]) {
      expect(parseServerMessage(snapshotWithLit(lit)).ok, JSON.stringify(lit)).toBe(false);
    }
  });

  it("round-trips a player carrying inventory", () => {
    const message: ServerMessage = {
      type: "playerJoined",
      player: {
        id: PLAYER_ID,
        name: "Grix",
        position: { x: 2, y: 2 },
        facing: { x: 0, y: 1 },
        health: 0,
        resistance: 40,
        stamina: 100,
        ready: true,
        connected: true,
        inventory: [
          {
            id: TARGET_ID,
            name: "Scroll of Iron Will",
            kind: "skillScroll",
            skillId: "iron-will",
          },
        ],
        held: null,
        carryingTorch: true,
        carryingPlayerId: null,
        carriedByPlayerId: null,
        bankedItems: [],
      },
    };

    const result = parseServerMessage(serializeServerMessage(message));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toEqual(message);
    }
  });

  it("rejects a skill scroll that does not say what it teaches", () => {
    const result = parseServerMessage(
      JSON.stringify({
        type: "playerJoined",
        player: {
          id: PLAYER_ID,
          name: "Grix",
          position: { x: 2, y: 2 },
          facing: { x: 0, y: 1 },
          health: 100,
          resistance: 40,
          stamina: 100,
          ready: false,
          connected: true,
          inventory: [{ id: TARGET_ID, name: "Blank Scroll", kind: "skillScroll" }],
          carryingTorch: false,
          carryingPlayerId: null,
          carriedByPlayerId: null,
          bankedItems: [],
        },
      }),
    );

    expect(result.ok).toBe(false);
  });

  it("rejects an item of an unknown kind", () => {
    const result = parseServerMessage(
      JSON.stringify({
        type: "playerJoined",
        player: {
          id: PLAYER_ID,
          name: "Grix",
          position: { x: 2, y: 2 },
          facing: { x: 0, y: 1 },
          health: 100,
          ready: false,
          connected: true,
          inventory: [{ id: TARGET_ID, name: "Vorpal Sword", kind: "sword" }],
        },
      }),
    );

    expect(result.ok).toBe(false);
  });

  it("rejects 'disconnected' as a leave reason, since a drop holds the slot", () => {
    const result = parseServerMessage(
      JSON.stringify({ type: "playerLeft", playerId: PLAYER_ID, reason: "disconnected" }),
    );

    expect(result.ok).toBe(false);
  });

  it("rejects a volume outside the 0..1 range", () => {
    const result = parseServerMessage(
      JSON.stringify({
        type: "voiceRangeUpdated",
        peers: [{ playerId: PLAYER_ID, distance: 1, volume: 1.5 }],
      }),
    );

    expect(result.ok).toBe(false);
  });
});
