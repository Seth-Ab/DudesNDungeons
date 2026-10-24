import { describe, expect, it } from "vitest";
import {
  BODY_TYPES,
  DEFAULT_APPEARANCE,
  HAIR_COLORS,
  HAIR_STYLES,
  PARTY_COLORS,
  SKIN_TONES,
} from "../../src/shared/constants/appearance.js";
import { EMOTES } from "../../src/shared/constants/emotes.js";
import {
  MAX_CLIENT_MESSAGE_BYTES,
  MAX_CLIENT_MESSAGE_CHARS,
  MAX_PLAYER_NAME_LENGTH,
  MAX_VOICE_SIGNAL_LENGTH,
  PROTOCOL_VERSION,
} from "../../src/shared/constants/game.js";
import {
  parseClientMessage,
  errorCodeSchema,
  parseServerMessage,
  serializeServerMessage,
  type ServerMessage,
} from "../../src/shared/protocol/index.js";
import {
  lightSourceStateSchema,
  mapDiscoverySchema,
  type PlayerState,
} from "../../src/shared/types/core.js";

const ZERO_STATS = {
  runsEscaped: 0,
  fullPartyEscapes: 0,
  wins: 0,
  emberWardenKills: 0,
  flawlessEmberWardenKills: 0,
  teammatesCarriedOut: 0,
  leverPuzzlesSolved: 0,
  runsWithoutTorch: 0,
  itemsBanked: 0,
  mothRoomsFound: 0,
};

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

  it("accepts a joinSession answering a saved run, and nothing else", () => {
    const join = (savedRun: unknown) =>
      parseClientMessage(
        JSON.stringify({
          type: "joinSession",
          protocolVersion: PROTOCOL_VERSION,
          roomCode: "BCDFGH",
          playerName: "Grix",
          savedRun,
        }),
      );

    expect(join("continue").ok).toBe(true);
    expect(join("discard").ok).toBe(true);
    expect(join(null).ok).toBe(true);
    expect(join(undefined).ok).toBe(true);
    expect(join("new").ok).toBe(false);
    expect(join(true).ok).toBe(false);
  });

  it("names the saved-run refusals as error codes", () => {
    for (const code of ["savedRunExists", "notSaveMember", "notPermitted"]) {
      expect(errorCodeSchema.safeParse(code).success).toBe(true);
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

  it("accepts a scroll conversion that names only the item, and refuses a client-sent amount", () => {
    const itemId = "e0000000-0000-4000-8000-000000000001";

    expect(parseClientMessage(JSON.stringify({ type: "convertSkillScroll", itemId })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: "convertSkillScroll" })).ok).toBe(false);
    // Strict, like the rest of the intents: a field the server would ignore is a malformed message.
    const withAmount = parseClientMessage(JSON.stringify({ type: "convertSkillScroll", itemId, coin: 999 }));
    expect(withAmount.ok && "coin" in withAmount.message).toBe(false);
  });

  it("accepts a bare saveAndQuit and refuses one that carries anything", () => {
    expect(parseClientMessage(JSON.stringify({ type: "saveAndQuit" })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: "saveAndQuit", position: { x: 1, y: 1 } })).ok).toBe(false);
  });

  it("accepts a purchase that names only the stock entry, and refuses a client-sent price", () => {
    const itemId = "iron-will-scroll";

    expect(parseClientMessage(JSON.stringify({ type: "buySkillScroll", itemId })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: "buySkillScroll" })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: "buySkillScroll", itemId: "Not A Slug" })).ok).toBe(false);
    const withPrice = parseClientMessage(JSON.stringify({ type: "buySkillScroll", itemId, price: 0 }));
    expect(withPrice.ok && "price" in withPrice.message).toBe(false);
  });

  it("accepts a cosmetic purchase by id only, and an equip by slot and id or null", () => {
    expect(parseClientMessage(JSON.stringify({ type: "buyCosmetic", id: "wizard-hat" })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: "buyCosmetic" })).ok).toBe(false);
    const withPrice = parseClientMessage(JSON.stringify({ type: "buyCosmetic", id: "wizard-hat", price: 0 }));
    expect(withPrice.ok && "price" in withPrice.message).toBe(false);

    expect(parseClientMessage(JSON.stringify({ type: "equipCosmetic", slot: "hat", id: "wizard-hat" })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: "equipCosmetic", slot: "cloak", id: null })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: "equipCosmetic", slot: "trail", id: "ember-sparks" })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: "equipCosmetic", slot: "flame", id: null })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: "equipCosmetic", slot: "aura", id: null })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: "equipCosmetic", slot: "hat" })).ok).toBe(false);
  });

  it("round-trips the wardrobe catalogue and refuses an unknown slot or rarity in it", () => {
    const entry = {
      id: "ranger-hood",
      slot: "hat",
      rarity: "fine",
      name: "Ranger's Hood",
      lore: "Hides every hair.",
      starter: false,
      price: 30,
      milestone: { stat: "runsEscaped", threshold: 5 },
      rotating: false,
      inStock: true,
    } as const;
    const catalogue: ServerMessage = { type: "wardrobeCatalog", entries: [entry] };
    const parsed = parseServerMessage(serializeServerMessage(catalogue));
    expect(parsed.ok && parsed.message).toEqual(catalogue);

    for (const bad of [{ slot: "boots" }, { rarity: "mythic" }, { price: 0 }]) {
      expect(parseServerMessage(JSON.stringify({ type: "wardrobeCatalog", entries: [{ ...entry, ...bad }] })).ok).toBe(false);
    }
  });

  it("round-trips the skill shop stock and the purchase rejection reasons", () => {
    const stock: ServerMessage = {
      type: "skillShopStock",
      entries: [{ itemId: "iron-will-scroll", name: "Scroll of Iron Will", skillId: "iron-will", price: 20, rotating: false }],
    };
    const parsed = parseServerMessage(serializeServerMessage(stock));
    expect(parsed.ok && parsed.message).toEqual(stock);
    expect(
      parseServerMessage(JSON.stringify({ ...stock, entries: [{ ...stock.entries[0], price: 0 }] })).ok,
    ).toBe(false);

    for (const reason of ["outOfStock", "insufficientCoin", "inventoryFull"] as const) {
      const message: ServerMessage = { type: "actionRejected", sequence: null, reason };
      const result = parseServerMessage(serializeServerMessage(message));
      expect(result.ok && result.message).toEqual(message);
    }
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

  it("accepts beginDraw and releaseDraw with a sequence and direction, and nothing about strength", () => {
    for (const type of ["beginDraw", "releaseDraw"]) {
      const message = { type, sequence: 3, direction: { x: 1, y: 0 } };
      expect(parseClientMessage(JSON.stringify(message)).ok).toBe(true);
      expect(parseClientMessage(JSON.stringify({ ...message, sequence: -1 })).ok).toBe(false);
      expect(parseClientMessage(JSON.stringify({ type, sequence: 3 })).ok).toBe(false);
      expect(parseClientMessage(JSON.stringify({ ...message, direction: { x: "a", y: 0 } })).ok).toBe(false);
    }
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

describe("appearance contract", () => {
  const LOOK = { body: "girl", skinTone: "olive", hairStyle: "ponytail", hairColor: "ginger" };

  function setAppearance(appearance: unknown) {
    return parseClientMessage(JSON.stringify({ type: "setAppearance", appearance }));
  }

  /** A full player entry as the server sends it, with `fields` replaced, possibly by bad values. */
  function playerWith(fields: Partial<Record<keyof PlayerState, unknown>>) {
    return {
      id: PLAYER_ID,
      name: "Grix",
      position: { x: 2, y: 2 },
      facing: { x: 0, y: 1 },
      health: 100,
      resistance: 40,
      stamina: 100,
      ready: false,
      connected: true,
      inventory: [],
      held: null,
      drawFraction: null,
      carryingTorch: false,
      carryingPlayerId: null,
      carriedByPlayerId: null,
      seatId: null,
      readyPlateId: null,
      appearance: LOOK,
      partyColor: "ember",
      cosmetics: { hat: null, cloak: null, dye: null, trail: null, flame: null },
      ...fields,
    };
  }

  it("is on protocol v48, the version that added the saved-run list", () => {
    expect(PROTOCOL_VERSION).toBe(49);
  });

  it("round-trips a refused Save and quit with its reason", () => {
    for (const reason of ["inCombat", "notPermitted"] as const) {
      const message: ServerMessage = { type: "saveAndQuitRefused", reason };
      const result = parseServerMessage(serializeServerMessage(message));
      expect(result.ok && result.message).toEqual(message);
    }
    expect(parseServerMessage(JSON.stringify({ type: "saveAndQuitRefused", reason: "nope" })).ok).toBe(false);
  });

  it("ships the id lists the design fixed", () => {
    expect(BODY_TYPES).toEqual(["guy", "girl"]);
    expect(SKIN_TONES).toEqual(["porcelain", "fair", "olive", "tan", "brown", "deep"]);
    expect(HAIR_STYLES).toEqual(["crop", "spiky", "long", "ponytail", "bun", "shaved"]);
    expect(HAIR_COLORS).toEqual([
      "black",
      "brown",
      "chestnut",
      "blonde",
      "ginger",
      "silver",
      "azure",
      "moss",
    ]);
    expect(PARTY_COLORS).toEqual(["ember", "moss", "azure", "plum"]);
  });

  it("accepts a setAppearance naming one id from each list", () => {
    const result = setAppearance(LOOK);

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toEqual({ type: "setAppearance", appearance: LOOK });
    expect(setAppearance(DEFAULT_APPEARANCE).ok).toBe(true);
  });

  it("rejects an unknown id in each field, naming the message it claimed to be", () => {
    for (const field of ["body", "skinTone", "hairStyle", "hairColor"]) {
      const result = setAppearance({ ...LOOK, [field]: "chartreuse" });

      expect(result.ok, field).toBe(false);
      if (!result.ok) expect(result.claimedType).toBe("setAppearance");
    }
  });

  it("rejects a missing field, an extra field, or no appearance at all", () => {
    const { hairColor: _dropped, ...missing } = LOOK;

    expect(setAppearance(missing).ok).toBe(false);
    expect(setAppearance({ ...LOOK, hat: "crown" }).ok).toBe(false);
    expect(setAppearance(null).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: "setAppearance" })).ok).toBe(false);
  });

  it("names no claimed type for a message type the protocol does not have", () => {
    const result = parseClientMessage(JSON.stringify({ type: "setHat", hat: "crown" }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.claimedType).toBeUndefined();
  });

  it("round-trips a designed player, a designing one, and sessionJoined's needsAppearance", () => {
    const message: ServerMessage = {
      type: "sessionJoined",
      sessionId: SESSION_ID,
      roomCode: "BCDFGH",
      playerId: PLAYER_ID,
      resumeToken: RESUME_TOKEN,
      resumed: false,
      needsAppearance: true,
      tickRate: 20,
      players: [
        playerWith({ appearance: null, partyColor: "moss" }) as PlayerState,
        playerWith({ id: TARGET_ID }) as PlayerState,
      ],
      profile: {
        id: PROFILE_ID,
        displayName: "Grix",
        bankedItems: [],
        skillStacks: {},
        coin: 0,
        stats: { runsEscaped: 0, fullPartyEscapes: 0, wins: 0, emberWardenKills: 0, flawlessEmberWardenKills: 0, teammatesCarriedOut: 0, leverPuzzlesSolved: 0, runsWithoutTorch: 0, itemsBanked: 0, mothRoomsFound: 0 },
        earnedMilestones: [],
        ownedCosmeticIds: ["leather-cap", "traveler-cape"],
        equippedCosmetics: { hat: null, cloak: null, dye: null, trail: null, flame: null },
        runsEscaped: 0,
        runsLost: 0,
      },
      profileSecret: null,
    };

    const result = parseServerMessage(serializeServerMessage(message));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toEqual(message);
  });

  it("rejects a player state with a malformed look or party colour", () => {
    for (const fields of [
      { appearance: { ...LOOK, body: "ogre" } },
      { appearance: { ...LOOK, cape: "red" } },
      { appearance: undefined },
      { partyColor: "teal" },
      { partyColor: undefined },
      { seatId: undefined },
      { seatId: "bench-1" },
      { seatId: 7 },
      { readyPlateId: undefined },
      { readyPlateId: "plate-1" },
    ]) {
      const result = parseServerMessage(
        JSON.stringify({ type: "playerJoined", player: playerWith(fields) }),
      );
      expect(result.ok, JSON.stringify(fields)).toBe(false);
    }
  });

  it("rejects a sessionJoined that does not say whether a look is needed", () => {
    const result = parseServerMessage(
      JSON.stringify({
        type: "sessionJoined",
        sessionId: SESSION_ID,
        roomCode: "BCDFGH",
        playerId: PLAYER_ID,
        resumeToken: RESUME_TOKEN,
        resumed: false,
        tickRate: 20,
        players: [],
        profile: {
          id: PROFILE_ID,
          displayName: "Grix",
          bankedItems: [],
          skillStacks: {},
          coin: 0,
          stats: { runsEscaped: 0, fullPartyEscapes: 0, wins: 0, emberWardenKills: 0, flawlessEmberWardenKills: 0, teammatesCarriedOut: 0, leverPuzzlesSolved: 0, runsWithoutTorch: 0, itemsBanked: 0, mothRoomsFound: 0 },
          earnedMilestones: [],
          ownedCosmeticIds: ["leather-cap", "traveler-cape"],
          equippedCosmetics: { hat: null, cloak: null, dye: null, trail: null, flame: null },
          runsEscaped: 0,
          runsLost: 0,
        },
        profileSecret: null,
      }),
    );

    expect(result.ok).toBe(false);
  });
});

describe("seat contract", () => {
  const SEAT = { id: TARGET_ID, x: 37.25, y: 23.25, facing: "south" };
  const discovery = (seats: unknown) => ({
    id: "hub",
    name: "The Ember Hearth",
    width: 92,
    height: 60,
    reset: true,
    discovered: [],
    lit: [],
    seats,
  });

  it("accepts a seated player and seats sent with map discovery", () => {
    const player = {
      id: PLAYER_ID,
      name: "Grix",
      position: { x: 37.25, y: 23.25 },
      facing: { x: 0, y: 1 },
      health: 100,
      resistance: 40,
      stamina: 100,
      ready: false,
      connected: true,
      inventory: [],
      held: null,
      drawFraction: null,
      carryingTorch: false,
      carryingPlayerId: null,
      carriedByPlayerId: null,
      seatId: TARGET_ID,
      readyPlateId: null,
      appearance: { body: "girl", skinTone: "olive", hairStyle: "ponytail", hairColor: "ginger" },
      partyColor: "ember",
      cosmetics: { hat: null, cloak: null, dye: null, trail: null, flame: null },
    };

    const joined = parseServerMessage(JSON.stringify({ type: "playerJoined", player }));
    expect(joined.ok).toBe(true);
    if (joined.ok && joined.message.type === "playerJoined") {
      expect(joined.message.player.seatId).toBe(TARGET_ID);
    }
    expect(mapDiscoverySchema.safeParse(discovery([SEAT])).success).toBe(true);
    for (const facing of ["north", "south", "east", "west"]) {
      expect(mapDiscoverySchema.safeParse(discovery([{ ...SEAT, facing }])).success, facing).toBe(true);
    }
  });

  it("rejects a malformed seat", () => {
    for (const seat of [
      { ...SEAT, id: "bench-1" },
      { ...SEAT, facing: "up" },
      { ...SEAT, x: Number.NaN },
      { id: TARGET_ID, x: 1, facing: "south" },
    ]) {
      expect(mapDiscoverySchema.safeParse(discovery([seat])).success, JSON.stringify(seat)).toBe(false);
    }
  });
});

describe("ready plate contract", () => {
  const PLATE = { id: TARGET_ID, x: 39.5, y: 9.5 };
  const discovery = (readyPlates: unknown) => ({
    id: "hub",
    name: "The Ember Hearth",
    width: 92,
    height: 60,
    reset: true,
    discovered: [],
    lit: [],
    readyPlates,
  });

  it("accepts plates sent with map discovery and a player holding one", () => {
    expect(mapDiscoverySchema.safeParse(discovery([PLATE])).success).toBe(true);
    const joined = parseServerMessage(
      JSON.stringify({
        type: "playerJoined",
        player: {
          id: PLAYER_ID,
          name: "Grix",
          position: { x: 39.5, y: 9.5 },
          facing: { x: 0, y: 1 },
          health: 100,
          resistance: 40,
          stamina: 100,
          ready: true,
          connected: true,
          inventory: [],
          held: null,
          drawFraction: null,
          carryingTorch: false,
          carryingPlayerId: null,
          carriedByPlayerId: null,
          seatId: null,
          readyPlateId: TARGET_ID,
          appearance: { body: "girl", skinTone: "olive", hairStyle: "ponytail", hairColor: "ginger" },
          partyColor: "ember",
          cosmetics: { hat: null, cloak: null, dye: null, trail: null, flame: null },
        },
      }),
    );
    expect(joined.ok).toBe(true);
    if (joined.ok && joined.message.type === "playerJoined") {
      expect(joined.message.player.readyPlateId).toBe(TARGET_ID);
    }
  });

  it("rejects a malformed plate", () => {
    for (const plate of [{ ...PLATE, id: "plate-1" }, { ...PLATE, x: Number.NaN }, { id: TARGET_ID, x: 1 }]) {
      expect(mapDiscoverySchema.safeParse(discovery([plate])).success, JSON.stringify(plate)).toBe(false);
    }
  });

  it("carries the party-ready cue on a ready change, and only as true", () => {
    const cue = { type: "playerReadyChanged", playerId: PLAYER_ID, ready: true, partyReady: true };
    const parsed = parseServerMessage(JSON.stringify(cue));
    expect(parsed.ok && parsed.message).toEqual(cue);
    expect(parseServerMessage(JSON.stringify({ ...cue, partyReady: undefined })).ok).toBe(true);
    expect(parseServerMessage(JSON.stringify({ ...cue, partyReady: false })).ok).toBe(false);
  });
});

describe("attackResolved swing geometry", () => {
  const swing = { origin: { x: 1, y: 2 }, facing: { x: 1, y: 0 }, range: 1.5, arcCos: 0.5 };
  const attack = {
    type: "attackResolved",
    attackerId: PLAYER_ID,
    targetId: null,
    damage: 0,
    targetHealth: 0,
    targetDefeated: false,
    swing,
  };
  const parse = (message: unknown) => parseServerMessage(JSON.stringify(message));

  it("accepts a swing, and null for an attack that has none", () => {
    expect(parse(attack).ok).toBe(true);
    expect(parse({ ...attack, swing: null }).ok).toBe(true);
  });

  it("rejects missing or out-of-range geometry", () => {
    const { swing: _omitted, ...withoutSwing } = attack;
    expect(parse(withoutSwing).ok).toBe(false);
    expect(parse({ ...attack, swing: { ...swing, range: 0 } }).ok).toBe(false);
    expect(parse({ ...attack, swing: { ...swing, arcCos: 1.5 } }).ok).toBe(false);
    expect(parse({ ...attack, swing: { ...swing, arcCos: -1.5 } }).ok).toBe(false);
    expect(parse({ ...attack, swing: { ...swing, origin: undefined } }).ok).toBe(false);
  });
});

describe("emote contract", () => {
  const emoted = { type: "playerEmoted", playerId: PLAYER_ID, kind: "wave", at: 12 };
  const parseServer = (message: unknown) => parseServerMessage(JSON.stringify(message));
  const parseClient = (message: unknown) => parseClientMessage(JSON.stringify(message));

  it("ships the emote ids the issue fixed, in wheel order", () => {
    expect(EMOTES).toEqual(["wave", "cheer", "point", "bow", "dance", "followMe", "wait", "help"]);
  });

  it("accepts an emote of every known kind", () => {
    for (const kind of EMOTES) {
      const result = parseClient({ type: "emote", kind });
      expect(result.ok, kind).toBe(true);
      if (result.ok) expect(result.message).toEqual({ type: "emote", kind });
    }
  });

  it("rejects an unknown, missing, or mistyped kind, naming the message it claimed to be", () => {
    for (const message of [
      { type: "emote", kind: "flex" },
      { type: "emote", kind: "WAVE" },
      { type: "emote" },
      { type: "emote", kind: 1 },
      { type: "emote", kind: null },
    ]) {
      const result = parseClient(message);
      expect(result.ok, JSON.stringify(message)).toBe(false);
      if (!result.ok) expect(result.claimedType).toBe("emote");
    }
  });

  it("round-trips playerEmoted", () => {
    const result = parseServer(emoted);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.message).toEqual(emoted);
  });

  it("rejects a malformed playerEmoted", () => {
    const { at: _at, ...withoutAt } = emoted;
    expect(parseServer(withoutAt).ok).toBe(false);
    expect(parseServer({ ...emoted, kind: "flex" }).ok).toBe(false);
    expect(parseServer({ ...emoted, at: -1 }).ok).toBe(false);
    expect(parseServer({ ...emoted, at: 1.5 }).ok).toBe(false);
    expect(parseServer({ ...emoted, playerId: "not-a-uuid" }).ok).toBe(false);
  });
});

describe("party vault contract", () => {
  const itemId = "a1111111-1111-4111-8111-111111111111";
  const parse = (message: unknown) => parseServerMessage(JSON.stringify(message));

  it("accepts withdrawVaultItem and depositVaultItem by item id, and rejects malformed ones", () => {
    for (const type of ["withdrawVaultItem", "depositVaultItem"]) {
      expect(parseClientMessage(JSON.stringify({ type, itemId })).ok).toBe(true);
      expect(parseClientMessage(JSON.stringify({ type })).ok).toBe(false);
      expect(parseClientMessage(JSON.stringify({ type, itemId: null })).ok).toBe(false);
      expect(parseClientMessage(JSON.stringify({ type, itemId: "nope" })).ok).toBe(false);
    }
  });

  it("round-trips the vault's contents, including an empty vault", () => {
    const items = [
      { id: itemId, name: "Copper Key", kind: "key" },
      { id: TARGET_ID, name: "Arrows", kind: "ammo", itemId: "arrow", count: 12 },
    ];
    for (const message of [{ type: "partyVault", items }, { type: "partyVault", items: [] }]) {
      const result = parse(message);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.message).toEqual(message);
    }
  });

  it("rejects a vault without its list or with a malformed item", () => {
    expect(parse({ type: "partyVault" }).ok).toBe(false);
    expect(parse({ type: "partyVault", items: [{ id: "nope", name: "Key", kind: "key" }] }).ok).toBe(false);
  });
});

describe("partyRoster contract", () => {
  const entry = { playerId: PLAYER_ID, name: "Grix", partyColor: "ember", connected: true };
  const roster = { type: "partyRoster", members: [entry] };
  const parse = (message: unknown) => parseServerMessage(JSON.stringify(message));

  it("round-trips a roster, including an empty one", () => {
    for (const message of [roster, { type: "partyRoster", members: [] }]) {
      const result = parse(message);
      expect(result.ok).toBe(true);
      if (result.ok) expect(result.message).toEqual(message);
    }
  });

  it("rejects malformed entries", () => {
    for (const bad of [
      { ...entry, playerId: "not-a-uuid" },
      { ...entry, name: "" },
      { ...entry, partyColor: "mauve" },
      { ...entry, connected: "yes" },
      { playerId: entry.playerId, name: entry.name, partyColor: entry.partyColor },
    ]) {
      expect(parse({ ...roster, members: [bad] }).ok, JSON.stringify(bad)).toBe(false);
    }
    expect(parse({ type: "partyRoster" }).ok).toBe(false);
    expect(parse({ ...roster, members: entry }).ok).toBe(false);
  });

  it("rejects an entry that carries anything about the body", () => {
    for (const extra of [
      { position: { x: 1, y: 2 } },
      { health: 40 },
      { resistance: 10 },
      { downed: true },
    ]) {
      expect(parse({ ...roster, members: [{ ...entry, ...extra }] }).ok, JSON.stringify(extra)).toBe(false);
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

  it("round-trips a sessionJoined carrying the resume token and the profile", () => {
    const message: ServerMessage = {
      type: "sessionJoined",
      sessionId: SESSION_ID,
      roomCode: "BCDFGH",
      playerId: PLAYER_ID,
      resumeToken: RESUME_TOKEN,
      resumed: true,
      needsAppearance: false,
      tickRate: 20,
      players: [],
      profile: {
        id: PROFILE_ID,
        displayName: "Grix",
        bankedItems: [],
        skillStacks: { "iron-will": 2 },
        coin: 0,
        stats: { runsEscaped: 0, fullPartyEscapes: 0, wins: 0, emberWardenKills: 0, flawlessEmberWardenKills: 0, teammatesCarriedOut: 0, leverPuzzlesSolved: 0, runsWithoutTorch: 0, itemsBanked: 0, mothRoomsFound: 0 },
        earnedMilestones: [],
        ownedCosmeticIds: ["leather-cap", "traveler-cape"],
        equippedCosmetics: { hat: null, cloak: null, dye: null, trail: null, flame: null },
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
      milestones: [
        {
          id: "seasoned-escapee",
          name: "Seasoned Escapee",
          stat: "runsEscaped",
          threshold: 5,
          skillId: "emberhardened",
        },
      ],
      skills: [
        {
          id: "iron-will",
          name: "Iron Will",
          description: "Start with more resistance.",
          effects: [{ type: "resistanceBonus", amount: 10 }],
          maxStacks: 3,
          requires: [],
          conversionCoin: 1,
          stackEffects: [
            [{ type: "resistanceBonus", amount: 5 }],
            [{ type: "resistanceBonus", amount: 5 }],
          ],
          perStackEffects: [],
        },
        {
          id: "quick-step",
          name: "Quick Step",
          description: "Keeps stacking.",
          effects: [{ type: "attackDamageBonus", amount: 1 }],
          maxStacks: null,
          requires: ["iron-will"],
          conversionCoin: 1,
          stackEffects: [],
          perStackEffects: [{ type: "attackDamageBonus", amount: 1 }],
        },
      ],
    };
    const state: ServerMessage = {
      type: "progressionUpdated",
      skillStacks: { "iron-will": 4 },
      runSkillStacks: { torchbearer: 1 },
      activeSkillStacks: { "iron-will": 3, torchbearer: 1 },
      coin: 12,
      runCoin: 4,
      stats: { ...ZERO_STATS, runsEscaped: 5, itemsBanked: 9 },
      earnedMilestones: ["seasoned-escapee"],
      ownedCosmeticIds: [],
    };

    for (const message of [catalog, state]) {
      const result = parseServerMessage(serializeServerMessage(message));
      expect(result.ok && result.message).toEqual(message);
    }
  });

  it("rejects progression state with a malformed id, a bad stack count or an unknown effect", () => {
    const update = (fields: Record<string, unknown>) =>
      parseServerMessage(
        JSON.stringify({
          type: "progressionUpdated",
          skillStacks: {},
          runSkillStacks: {},
          activeSkillStacks: {},
          coin: 0,
          runCoin: 0,
          stats: ZERO_STATS,
          earnedMilestones: [],
          ownedCosmeticIds: [],
          ...fields,
        }),
      );
    const skill = {
      id: "x",
      name: "X",
      description: "d",
      effects: [{ type: "resistanceBonus", amount: 1 }],
      maxStacks: 1,
      requires: [],
      conversionCoin: 1,
      stackEffects: [],
      perStackEffects: [],
    };
    const catalog = (fields: Record<string, unknown>) =>
      parseServerMessage(JSON.stringify({ type: "progressionCatalog", milestones: [], skills: [{ ...skill, ...fields }] }));

    expect(update({}).ok).toBe(true);
    expect(update({ stats: undefined }).ok).toBe(false);
    expect(update({ stats: { ...ZERO_STATS, wins: -1 } }).ok).toBe(false);
    expect(update({ stats: { ...ZERO_STATS, wins: 1.5 } }).ok).toBe(false);
    expect(update({ earnedMilestones: undefined }).ok).toBe(false);
    expect(update({ earnedMilestones: ["Not A Slug"] }).ok).toBe(false);
    expect(update({ skillStacks: { "Not A Slug": 1 } }).ok).toBe(false);
    expect(update({ runSkillStacks: { "iron-will": 0 } }).ok).toBe(false);
    expect(update({ activeSkillStacks: { "iron-will": 1.5 } }).ok).toBe(false);
    // The retired upgrade fields are not part of the contract any more.
    expect(update({ skillStacks: undefined, unlockedSkillIds: ["iron-will"] }).ok).toBe(false);
    expect(catalog({}).ok).toBe(true);
    expect(catalog({ effects: [{ type: "godMode", amount: 1 }] }).ok).toBe(false);
    expect(catalog({ maxStacks: 0 }).ok).toBe(false);
    expect(catalog({ requires: ["Not A Slug"] }).ok).toBe(false);
    expect(catalog({ perStackEffects: undefined }).ok).toBe(false);
  });

  it("round-trips the skill scroll rejection reasons", () => {
    for (const reason of ["skillMaxed", "missingPrerequisites"] as const) {
      const message: ServerMessage = { type: "actionRejected", sequence: 4, reason };
      const result = parseServerMessage(serializeServerMessage(message));
      expect(result.ok && result.message).toEqual(message);
    }
    expect(
      parseServerMessage(JSON.stringify({ type: "actionRejected", sequence: 4, reason: "skillUpgraded" })).ok,
    ).toBe(false);
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
        dummies: [
          {
            id: "66666666-6666-4666-8666-666666666666",
            position: { x: 2, y: 2 },
            recentDamage: 12,
            dps: 4.5,
            attackers: [{ playerId: PLAYER_ID, recentDamage: 12, dps: 4.5 }],
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
          dummies: [],
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
        drawFraction: null,
        carryingTorch: true,
        carryingPlayerId: null,
        carriedByPlayerId: null,
        seatId: null,
        readyPlateId: null,
        appearance: { body: "girl", skinTone: "deep", hairStyle: "bun", hairColor: "azure" },
        partyColor: "plum",
        cosmetics: { hat: null, cloak: null, dye: null, trail: null, flame: null },
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
          seatId: null,
          readyPlateId: null,
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

describe("map scenery on the wire", () => {
  const base = { id: "hub", name: "Hub", width: 8, height: 8, reset: true, discovered: [], lit: [] };

  it("accepts a theme, props with captions, and a tinted light, and leaves them optional", () => {
    expect(mapDiscoverySchema.safeParse(base).success).toBe(true);
    expect(
      mapDiscoverySchema.safeParse({
        ...base,
        theme: "forest",
        props: [{ kind: "stall", x: 8, y: 4, label: "Torches" }, { kind: "bush", x: 1.5, y: 2 }],
      }).success,
    ).toBe(true);
    expect(
      lightSourceStateSchema.safeParse({
        id: PLAYER_ID,
        name: "Gate Glow",
        kind: "fixed",
        position: { x: 1, y: 1 },
        radius: 6,
        tint: "red",
      }).success,
    ).toBe(true);
  });

  it("refuses an unknown theme, prop kind, overlong caption, or tint", () => {
    expect(mapDiscoverySchema.safeParse({ ...base, theme: "swamp" }).success).toBe(false);
    expect(mapDiscoverySchema.safeParse({ ...base, props: [{ kind: "windmill", x: 0, y: 0 }] }).success).toBe(false);
    expect(
      mapDiscoverySchema.safeParse({ ...base, props: [{ kind: "sign", x: 0, y: 0, label: "x".repeat(33) }] }).success,
    ).toBe(false);
    expect(
      lightSourceStateSchema.safeParse({
        id: PLAYER_ID,
        name: "Lamp",
        kind: "fixed",
        position: { x: 1, y: 1 },
        radius: 6,
        tint: "green",
      }).success,
    ).toBe(false);
  });
});

describe("map ground on the wire", () => {
  const base = { id: "hub", name: "Hub", width: 8, height: 8, reset: true, lit: [] };

  it("accepts a run with ground covering exactly its tiles, and a run without", () => {
    expect(
      mapDiscoverySchema.safeParse({
        ...base,
        discovered: [{ x: 0, y: 0, tiles: "#..", ground: ".gc" }, { x: 0, y: 1, tiles: "." }],
      }).success,
    ).toBe(true);
  });

  it("refuses ground of another length than its run, or with an unknown character", () => {
    expect(
      mapDiscoverySchema.safeParse({ ...base, discovered: [{ x: 0, y: 0, tiles: "..", ground: "g" }] }).success,
    ).toBe(false);
    expect(
      mapDiscoverySchema.safeParse({ ...base, discovered: [{ x: 0, y: 0, tiles: "..", ground: "gx" }] }).success,
    ).toBe(false);
  });

  it("accepts a stall tint and refuses an unknown one", () => {
    const stall = { kind: "stall", x: 0, y: 0 };
    const withTint = (tint: string) => ({ ...base, discovered: [], props: [{ ...stall, tint }] });

    expect(mapDiscoverySchema.safeParse(withTint("plum")).success).toBe(true);
    expect(mapDiscoverySchema.safeParse(withTint("gold")).success).toBe(false);
  });

  it("accepts the hub's benches, logs and campfire, and a north facing, and refuses an unknown facing", () => {
    const props = (facing?: string) => ({
      ...base,
      discovered: [],
      props: [
        { kind: "bench", x: 0, y: 0, ...(facing ? { facing } : {}) },
        { kind: "log", x: 4, y: 0 },
        { kind: "campfire", x: 8, y: 0 },
      ],
    });

    expect(mapDiscoverySchema.safeParse(props()).success).toBe(true);
    expect(mapDiscoverySchema.safeParse(props("north")).success).toBe(true);
    expect(mapDiscoverySchema.safeParse(props("west")).success).toBe(false);
  });
});

describe("the saved-run list", () => {
  const SECRET = "0123456789abcdef0123456789abcdef";
  const CHARACTER = {
    name: "Alpha",
    appearance: { body: "girl", skinTone: "tan", hairStyle: "bun", hairColor: "silver" },
    partyColor: "ember",
  } as const;

  it("accepts a listSavedRuns carrying only a profile secret", () => {
    expect(parseClientMessage(JSON.stringify({ type: "listSavedRuns", profileSecret: SECRET })).ok).toBe(true);
    expect(parseClientMessage(JSON.stringify({ type: "listSavedRuns" })).ok).toBe(false);
    expect(parseClientMessage(JSON.stringify({ type: "listSavedRuns", profileSecret: "nope" })).ok).toBe(false);
    expect(
      parseClientMessage(JSON.stringify({ type: "listSavedRuns", profileSecret: SECRET, roomCode: "BCDFGH" })).ok,
    ).toBe(false);
  });

  it("round-trips a savedRuns list of cards", () => {
    const message: ServerMessage = {
      type: "savedRuns",
      runs: [
        {
          roomCode: "BCDFGH",
          dungeonName: "Ember Vault",
          character: CHARACTER,
          teammates: [{ ...CHARACTER, name: "Beta", partyColor: "moss" }],
          playedMs: 34 * 60_000,
          lastPlayedAt: 1_700_000_000_000,
        },
      ],
    };

    const result = parseServerMessage(serializeServerMessage(message));
    expect(result.ok && result.message).toEqual(message);
  });

  it("refuses a card with an appearance id off the shared lists", () => {
    const message = {
      type: "savedRuns",
      runs: [
        {
          roomCode: "BCDFGH",
          dungeonName: null,
          character: { ...CHARACTER, appearance: { ...CHARACTER.appearance, hairColor: "chartreuse" } },
          teammates: [],
          playedMs: 0,
          lastPlayedAt: 0,
        },
      ],
    };
    expect(parseServerMessage(JSON.stringify(message)).ok).toBe(false);
  });
});
