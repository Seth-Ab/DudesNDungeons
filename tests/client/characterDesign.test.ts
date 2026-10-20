import { describe, expect, it } from "vitest";
import {
  initialSessionView,
  type SessionView,
} from "../../src/client/network/sessionState.js";
import {
  createLocalStorageLookStore,
  createMemoryLookStore,
  designScreenState,
  parseStoredLook,
  randomLook,
  startingLook,
} from "../../src/client/state/characterDesign.js";
import {
  BODY_TYPES,
  HAIR_COLORS,
  HAIR_STYLES,
  SKIN_TONES,
} from "../../src/shared/constants/appearance.js";
import type { PlayerState } from "../../src/shared/types/core.js";

const SELF_ID = "8f1d6b0e-6a4a-4f2e-9d1c-2b3a4c5d6e7f";
const LOOK = { body: "girl", skinTone: "tan", hairStyle: "bun", hairColor: "ginger" } as const;

function self(appearance: PlayerState["appearance"]): PlayerState {
  return {
    id: SELF_ID,
    name: "Maya",
    position: { x: 0, y: 0 },
    facing: { x: 0, y: 1 },
    health: 100,
    resistance: 40,
    stamina: 100,
    ready: false,
    connected: true,
    inventory: [],
    held: null,
    carryingTorch: false,
    carryingPlayerId: null,
    carriedByPlayerId: null,
    seatId: null,
    appearance,
    partyColor: "azure",
    bankedItems: [],
  };
}

function joined(needsAppearance: boolean, appearance: PlayerState["appearance"] = null): SessionView {
  return {
    ...initialSessionView,
    phase: "inSession",
    selfId: SELF_ID,
    roomCode: "KX7QF",
    needsAppearance,
    players: [self(appearance)],
  };
}

describe("designScreenState", () => {
  it("shows the step when the server asked for a look and the player has none", () => {
    const state = designScreenState(joined(true), undefined, 4);
    expect(state).toMatchObject({ visible: true, entering: false, error: null });
    expect(state.roomLine).toBe("Joining KX7QF · 1 of 4 here");
  });

  it("is hidden when the slot already has a look", () => {
    expect(designScreenState(joined(false, LOOK), undefined, 4).visible).toBe(false);
  });

  it("comes down once the look arrives in a snapshot", () => {
    expect(designScreenState(joined(true, LOOK), null, 4).visible).toBe(false);
  });

  it("is hidden outside a session", () => {
    expect(designScreenState({ ...joined(true), phase: "offline" }, undefined, 4).visible).toBe(false);
  });

  it("shows Entering… until the server answers", () => {
    expect(designScreenState(joined(true), null, 4)).toMatchObject({ entering: true, error: null });
  });

  it("shows the server's refusal inline and lets the player try again", () => {
    const view: SessionView = {
      ...joined(true),
      lastError: { code: "invalidAppearance", message: "That look is not allowed." },
    };
    expect(designScreenState(view, null, 4)).toMatchObject({
      visible: true,
      entering: false,
      error: "That look is not allowed.",
    });
  });

  it("does not take an error that predates the send for the answer", () => {
    const stale = { code: "invalidAppearance", message: "old" } as const;
    const view: SessionView = { ...joined(true), lastError: stale };
    expect(designScreenState(view, stale, 4)).toMatchObject({ entering: true, error: null });
  });

  it("goes back to the lobby view when the player leaves", () => {
    expect(designScreenState({ ...initialSessionView }, undefined, 4).visible).toBe(false);
  });
});

describe("starting look", () => {
  const first = () => 0;

  it("opens on the stored look", () => {
    const store = createMemoryLookStore();
    store.write(LOOK);
    expect(startingLook(store, first)).toEqual(LOOK);
  });

  it("opens on a random look with nothing stored, never blank", () => {
    expect(startingLook(createMemoryLookStore(), first)).toEqual({
      body: BODY_TYPES[0],
      skinTone: SKIN_TONES[0],
      hairStyle: HAIR_STYLES[0],
      hairColor: HAIR_COLORS[0],
    });
  });

  it("falls back to random when a stored id is no longer offered", () => {
    const raw = JSON.stringify({ ...LOOK, hairStyle: "mohawk" });
    expect(parseStoredLook(raw)).toBeNull();
    const store = { read: () => raw, write: () => undefined };
    expect(startingLook(store, first).hairStyle).toBe(HAIR_STYLES[0]);
  });

  it.each([["not json"], ["null"], ['"text"'], ["{}"], [JSON.stringify({ ...LOOK, extra: 1, body: 3 })]])(
    "ignores unreadable stored value %s",
    (raw) => {
      expect(parseStoredLook(raw)).toBeNull();
    },
  );

  it("picks only ids the server accepts, at either end of the random range", () => {
    for (const roll of [0, 0.5, 0.999999]) {
      const look = randomLook(() => roll);
      expect(BODY_TYPES).toContain(look.body);
      expect(SKIN_TONES).toContain(look.skinTone);
      expect(HAIR_STYLES).toContain(look.hairStyle);
      expect(HAIR_COLORS).toContain(look.hairColor);
    }
  });
});

describe("look store", () => {
  it("round trips through storage", () => {
    const values = new Map<string, string>();
    const store = createLocalStorageLookStore({
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => void values.set(key, value),
    });
    store.write(LOOK);
    expect(parseStoredLook(store.read())).toEqual(LOOK);
  });

  it("keeps working when storage throws", () => {
    const store = createLocalStorageLookStore({
      getItem: () => {
        throw new Error("blocked");
      },
      setItem: () => {
        throw new Error("blocked");
      },
    });
    expect(() => store.write(LOOK)).not.toThrow();
    expect(store.read()).toBeNull();
    expect(startingLook(store, () => 0).body).toBe(BODY_TYPES[0]);
  });
});
