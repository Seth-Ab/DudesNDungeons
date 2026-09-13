import { describe, expect, it } from "vitest";
import {
  MAX_CLIENT_MESSAGE_CHARS,
  MAX_PLAYER_NAME_LENGTH,
  PROTOCOL_VERSION,
} from "../../src/shared/constants/game.js";
import {
  parseClientMessage,
  parseServerMessage,
  serializeClientMessage,
  serializeServerMessage,
  type ClientMessage,
  type ServerMessage,
} from "../../src/shared/protocol/index.js";

const PLAYER_ID = "8f1d6b0e-6a4a-4f2e-9d1c-2b3a4c5d6e7f";
const TARGET_ID = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

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

  it("rejects non-finite movement components", () => {
    const result = parseClientMessage(
      '{"type":"playerMoveIntent","sequence":1,"direction":{"x":1e999,"y":0}}',
    );

    expect(result.ok).toBe(false);
  });

  it("rejects a negative sequence number", () => {
    const result = parseClientMessage(
      JSON.stringify({
        type: "playerMoveIntent",
        sequence: -1,
        direction: { x: 0, y: 1 },
      }),
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

  it("round-trips a serialized client message", () => {
    const message: ClientMessage = {
      type: "playerAttack",
      sequence: 4,
      direction: { x: 1, y: 0 },
      targetId: TARGET_ID,
    };

    const result = parseClientMessage(serializeClientMessage(message));

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.message).toEqual(message);
    }
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
