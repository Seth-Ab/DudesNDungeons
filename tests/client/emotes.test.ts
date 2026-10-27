import { describe, expect, it } from "vitest";
import { applyServerMessage, initialSessionView, type SessionView } from "../../src/client/network/sessionState.js";
import {
  createEmoteField,
  EMOTE_BUBBLE_LIFETIME_MS,
  EMOTE_TEXT,
  emoteAllowed,
  emoteFeedLine,
  emoteForDigit,
  newEmotes,
  placeEmotes,
} from "../../src/client/state/emotes.js";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import { EMOTES } from "../../src/shared/constants/emotes.js";
import type { PlayerState } from "../../src/shared/types/core.js";

const SELF_ID = "8f1d6b0e-6a4a-4f2e-9d1c-2b3a4c5d6e7f";
const ALLY_ID = "1a2b3c4d-5e6f-4a8b-9c0d-1e2f3a4b5c6d";

function player(id: string, overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id,
    name: id === SELF_ID ? "Self" : "Ash",
    position: { x: 0, y: 0 },
    facing: { x: 0, y: 1 },
    health: 100,
    resistance: 40,
    stamina: 100,
    ready: false,
    connected: true,
    inventory: [],
    held: null,
    drawFraction: null,
    drawRange: null,
    carryingTorch: false,
    torchLit: true,
    carryingPlayerId: null,
    carriedByPlayerId: null,
    seatId: null,
    readyPlateId: null,
    appearance: { ...DEFAULT_APPEARANCE },
    partyColor: "ember",
    cosmetics: { hat: null, cloak: null, dye: null, trail: null, flame: null },
    bankedItems: [],
    ...overrides,
  };
}

describe("emote wheel keys", () => {
  it("maps 1-8 to the wheel's emotes in order and nothing else", () => {
    expect(EMOTES.map((_, index) => emoteForDigit(`${index + 1}`))).toEqual([...EMOTES]);
    for (const key of ["0", "9", "a", "10", " ", "Enter"]) expect(emoteForDigit(key), key).toBeNull();
  });

  it("names every emote for the wheel, the bubble, and the feed", () => {
    for (const kind of EMOTES) {
      expect(EMOTE_TEXT[kind].name, kind).not.toBe("");
      expect(EMOTE_TEXT[kind].bubble, kind).not.toBe("");
      expect(EMOTE_TEXT[kind].feed, kind).not.toBe("");
    }
  });

  it("mirrors the server: anything standing, only help downed, nothing without a character", () => {
    const standing = player(SELF_ID);
    const downed = player(SELF_ID, { health: 0 });
    const designing = player(SELF_ID, { appearance: null });

    expect(EMOTES.every((kind) => emoteAllowed(standing, kind))).toBe(true);
    expect(EMOTES.filter((kind) => emoteAllowed(downed, kind))).toEqual(["help"]);
    expect(EMOTES.some((kind) => emoteAllowed(designing, kind))).toBe(false);
    expect(EMOTES.some((kind) => emoteAllowed(null, kind))).toBe(false);
  });
});

describe("emote bubbles", () => {
  it("lasts about two seconds, fading by progress", () => {
    const field = createEmoteField();
    field.add(ALLY_ID, "wave", 1000);

    expect(field.active(1000)).toEqual([{ playerId: ALLY_ID, text: "*waves*", progress: 0 }]);
    expect(field.active(2000)[0]?.progress).toBeCloseTo(0.5);
    expect(field.active(1000 + EMOTE_BUBBLE_LIFETIME_MS)).toEqual([]);
  });

  it("replaces a player's bubble rather than stacking a second one", () => {
    const field = createEmoteField();
    field.add(ALLY_ID, "wave", 0);
    field.add(SELF_ID, "cheer", 100);
    field.add(ALLY_ID, "help", 200);

    expect(field.active(300).map((bubble) => bubble.text)).toEqual(["Hooray!", "Help!"]);
  });

  it("pins bubbles to drawn positions and drops one whose emoter is out of view", () => {
    const field = createEmoteField();
    field.add(ALLY_ID, "wave", 0);
    field.add(SELF_ID, "wait", 0);

    const placed = placeEmotes(field.active(0), (id) => (id === SELF_ID ? { x: 3, y: 4 } : null));
    expect(placed).toEqual([{ playerId: SELF_ID, text: "Wait!", progress: 0, position: { x: 3, y: 4 } }]);
  });
});

describe("playerEmoted in the session view", () => {
  const view: SessionView = {
    ...initialSessionView,
    phase: "inSession",
    selfId: SELF_ID,
    players: [player(SELF_ID), player(ALLY_ID)],
  };
  const emoted = (playerId: string, kind: (typeof EMOTES)[number], at = 1) =>
    ({ type: "playerEmoted", playerId, kind, at }) as const;

  it("records each emote in order and writes a line to the action feed", () => {
    const first = applyServerMessage(view, emoted(ALLY_ID, "followMe"));
    const second = applyServerMessage(first, emoted(SELF_ID, "wave"));

    expect(first.lastAction).toBe("Ash says follow me.");
    expect(second.lastAction).toBe("You: Wave");
    expect(second.emoteSeq).toBe(2);
    expect(newEmotes(second.recentEmotes, 1)).toEqual([{ seq: 2, playerId: SELF_ID, kind: "wave" }]);
  });

  it("caps the history so a long session does not grow it", () => {
    let next = view;
    for (let index = 0; index < 40; index += 1) next = applyServerMessage(next, emoted(ALLY_ID, "dance"));

    expect(next.emoteSeq).toBe(40);
    expect(next.recentEmotes.length).toBeLessThan(40);
    expect(next.recentEmotes.at(-1)?.seq).toBe(40);
  });

  it("names an emoter it has no roster entry for without failing", () => {
    expect(emoteFeedLine([], SELF_ID, ALLY_ID, "help")).toBe("Someone calls for help!");
  });
});
