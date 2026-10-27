import { describe, expect, it } from "vitest";
import { INTERACT_RANGE } from "../../src/shared/constants/game.js";
import type { AltarState, DungeonState, PlayerState } from "../../src/shared/types/core.js";
import { initialSessionView, type SessionView } from "../../src/client/network/sessionState.js";
import { actionPrompt } from "../../src/client/state/hudView.js";
import { altarPhase, altarSlots, nearestOfferedSlot, scrollName } from "../../src/client/state/altars.js";
import { nearestInteraction } from "../../src/client/state/reach.js";

const SELF_ID = "self";
const OFFER = ["iron-will-scroll", "lever-sense-scroll"];

function altar(overrides: Partial<AltarState> = {}): AltarState {
  return { id: "altar-1", position: { x: 10, y: 10 }, offer: OFFER, taken: null, ...overrides };
}

function viewWith(altars: AltarState[]): SessionView {
  const self = { id: SELF_ID, name: "Maya", health: 100, inventory: [], held: 0, seatId: null, position: { x: 10, y: 10 } } as unknown as PlayerState;
  return {
    ...initialSessionView,
    phase: "inSession",
    selfId: SELF_ID,
    location: "dungeon",
    players: [self],
    visiblePlayerIds: [SELF_ID],
    dungeon: { map: { name: "Test", width: 4, height: 4, tiles: [] }, monsters: [], loot: [], chests: [], altars, doors: [], switches: [], exits: [], rooms: [] } as unknown as DungeonState,
  };
}

describe("altar slots", () => {
  it("lays the offer left to right about the altar and marks every slot offered", () => {
    const slots = altarSlots(altar());

    expect(slots.map((slot) => slot.itemId)).toEqual(OFFER);
    expect(slots.map((slot) => slot.state)).toEqual(["offered", "offered"]);
    expect(slots[0]!.position.x).toBeLessThan(10);
    expect(slots[1]!.position.x).toBeGreaterThan(10);
    expect(slots[0]!.position.y).toBe(10);
  });

  it("marks the chosen scroll taken and the rest caged", () => {
    const spent = altar({ taken: OFFER[1]! });

    expect(altarSlots(spent).map((slot) => slot.state)).toEqual(["caged", "taken"]);
    expect(altarPhase(altar())).toBe("offered");
    expect(altarPhase(spent)).toBe("spent");
  });

  it("finds the offered slot nearest a point, and none once the altar is spent", () => {
    expect(nearestOfferedSlot(altar(), { x: 8, y: 10 })?.itemId).toBe(OFFER[0]);
    expect(nearestOfferedSlot(altar(), { x: 12, y: 10 })?.itemId).toBe(OFFER[1]);
    expect(nearestOfferedSlot(altar({ taken: OFFER[0]! }), { x: 8, y: 10 })).toBeNull();
  });
});

describe("scroll names", () => {
  it("uses the skill's own name when the catalogue has it, and title-cases an id it does not", () => {
    const withSkills = {
      ...viewWith([]),
      progression: { skills: [{ id: "iron-will", name: "Iron Will" }] },
    } as unknown as SessionView;

    expect(scrollName(withSkills, "iron-will-scroll")).toBe("Scroll of Iron Will");
    expect(scrollName(viewWith([]), "lever-sense-scroll")).toBe("Scroll of Lever Sense");
  });
});

describe("taking a scroll from an altar", () => {
  const origin = { x: 9.2, y: 10 };

  it("targets the altar with the scroll nearest the player", () => {
    const view = viewWith([altar()]);

    expect(nearestInteraction(view, { x: 9.2, y: 10 })).toMatchObject({ id: "altar-1", kind: "altar", choiceItemId: OFFER[0] });
    expect(nearestInteraction(view, { x: 10.8, y: 10 })).toMatchObject({ id: "altar-1", kind: "altar", choiceItemId: OFFER[1] });
  });

  it("prompts to take the nearest scroll by name", () => {
    const view = viewWith([altar()]);
    const self = view.players[0]!;

    expect(actionPrompt(view, self, origin)).toMatchObject({ action: "interact", text: "Take Scroll of Iron Will" });
    expect(actionPrompt(view, self, { x: 10.8, y: 10 })).toMatchObject({ text: "Take Scroll of Lever Sense" });
  });

  it("offers nothing outside reach or once the altar is caged", () => {
    const view = viewWith([altar()]);
    const self = view.players[0]!;

    expect(actionPrompt(view, self, { x: 10 + INTERACT_RANGE + 1, y: 10 })).toBeNull();
    const spent = viewWith([altar({ taken: OFFER[0]! })]);
    expect(nearestInteraction(spent, origin)).toBeNull();
    expect(actionPrompt(spent, spent.players[0]!, origin)).toBeNull();
  });
});
