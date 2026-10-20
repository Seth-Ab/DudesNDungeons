import { describe, expect, it } from "vitest";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import { initialSessionView, type SessionView } from "../../src/client/network/sessionState.js";
import { flyInStart, itemFeedbackEvents } from "../../src/client/state/itemFeedback.js";
import type { DungeonState, InventoryItem, LootState, PlayerState } from "../../src/shared/types/core.js";

const SELF_ID = "8f1d6b0e-6a4a-4f2e-9d1c-2b3a4c5d6e7f";
const ALLY_ID = "9a2e7c1f-7b5b-4a3f-8e2d-3c4b5d6e7f80";

function player(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: SELF_ID,
    name: "Maya",
    position: { x: 5, y: 5 },
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
    appearance: { ...DEFAULT_APPEARANCE },
    partyColor: "ember",
    bankedItems: [],
    ...overrides,
  };
}

function tonic(id: string): InventoryItem {
  return { id, name: "Tonic", kind: "consumable", itemId: "minor-tonic", description: "Heals.", icon: "tonic", useOn: "self" };
}

function arrows(id: string, count: number): InventoryItem {
  return { id, name: "Arrows", kind: "ammo", itemId: "arrow", count };
}

function sword(id: string): InventoryItem {
  return { id, name: "Sword", kind: "weapon", itemId: "short-sword", weaponKind: "melee" } as InventoryItem;
}

function asLoot(item: InventoryItem, x: number, y: number): LootState {
  return { ...item, position: { x, y }, pickedUp: false } as LootState;
}

function view(self: PlayerState, loot: LootState[] = [], others: PlayerState[] = [], location: SessionView["location"] = "dungeon"): SessionView {
  const dungeon = { map: { name: "Test", width: 4, height: 4, tiles: [] }, loot } as unknown as DungeonState;
  return { ...initialSessionView, phase: "inSession", selfId: SELF_ID, players: [self, ...others], dungeon, location };
}

describe("item feedback events", () => {
  it("pulses the slot a used item was in, even when the slots after it shift down", () => {
    const before = view(player({ inventory: [tonic("a"), tonic("b")] }));
    const after = view(player({ inventory: [tonic("b")] }));
    expect(itemFeedbackEvents(before, after)).toEqual([{ type: "use", slot: 0 }]);
  });

  it("does not pulse when the server refused the use and nothing changed", () => {
    const self = player({ inventory: [tonic("a")] });
    expect(itemFeedbackEvents(view(self), view(player({ inventory: [tonic("a")] })))).toEqual([]);
  });

  it("does not count a dropped or a given item as used", () => {
    const before = view(player({ inventory: [tonic("a"), tonic("b")] }), [], [player({ id: ALLY_ID })]);
    const after = view(
      player({ inventory: [] }),
      [asLoot(tonic("a"), 5, 5)],
      [player({ id: ALLY_ID, inventory: [tonic("b")] })],
    );
    expect(itemFeedbackEvents(before, after)).toEqual([]);
  });

  it("pulses a stack whose count went down where it now sits", () => {
    const before = view(player({ inventory: [tonic("a"), arrows("s", 5)] }));
    const after = view(player({ inventory: [tonic("a"), arrows("s", 4)] }));
    expect(itemFeedbackEvents(before, after)).toEqual([{ type: "use", slot: 1 }]);
  });

  it("flies a picked-up item from its floor position into the slot that took it", () => {
    const before = view(player({ inventory: [tonic("a")] }), [asLoot(tonic("b"), 6, 7)]);
    const after = view(player({ inventory: [tonic("a"), tonic("b")] }), [{ ...asLoot(tonic("b"), 6, 7), pickedUp: true }]);
    expect(itemFeedbackEvents(before, after)).toEqual([
      { type: "pickup", slot: 1, sprite: "loot-tonic", from: { x: 6, y: 7 } },
    ]);
  });

  it("sends a weapon picked up into an empty hand to the hand slot", () => {
    const before = view(player(), [asLoot(sword("w"), 4, 5)]);
    const after = view(player({ held: sword("w") }));
    expect(itemFeedbackEvents(before, after)).toMatchObject([{ type: "pickup", slot: "held", from: { x: 4, y: 5 } }]);
  });

  it("shows nothing for a pickup refused because the inventory is full", () => {
    const full = [tonic("a"), tonic("b"), tonic("c")];
    const floor = [asLoot(tonic("d"), 6, 5)];
    expect(itemFeedbackEvents(view(player({ inventory: full }), floor), view(player({ inventory: [...full] }), floor))).toEqual([]);
  });

  it("flies a stack increment from the pile that shrank, and a new stack from the same pile", () => {
    const pile = asLoot(arrows("pile", 30), 7, 5);
    const before = view(player({ inventory: [arrows("s", 15)] }), [pile]);
    const after = view(player({ inventory: [arrows("s", 20), arrows("fresh", 20)] }), [{ ...pile, count: 5 } as LootState]);
    expect(itemFeedbackEvents(before, after)).toEqual([
      { type: "pickup", slot: 0, sprite: "loot-arrow", from: { x: 7, y: 5 } },
      { type: "pickup", slot: 1, sprite: "loot-arrow", from: { x: 7, y: 5 } },
    ]);
  });

  it("stays quiet when an item only swaps between the hand and a slot", () => {
    const before = view(player({ inventory: [tonic("a"), sword("w2")], held: sword("w1") }));
    const after = view(player({ inventory: [tonic("a"), sword("w1")], held: sword("w2") }));
    expect(itemFeedbackEvents(before, after)).toEqual([]);
  });

  it("flies an item an ally handed over from where the ally stands", () => {
    const before = view(player(), [], [player({ id: ALLY_ID, position: { x: 6, y: 6 }, inventory: [tonic("g")] })]);
    const after = view(player({ inventory: [tonic("g")] }), [], [player({ id: ALLY_ID, position: { x: 6, y: 6 } })]);
    expect(itemFeedbackEvents(before, after)).toMatchObject([{ type: "pickup", slot: 0, from: { x: 6, y: 6 } }]);
  });

  it("flies a picked-up torch into the torch pip", () => {
    const torch: LootState = { id: "t", name: "Torch", kind: "torch", position: { x: 5, y: 6 }, pickedUp: false };
    const before = view(player(), [torch]);
    const after = view(player({ carryingTorch: true }), [{ ...torch, pickedUp: true }]);
    expect(itemFeedbackEvents(before, after)).toEqual([
      { type: "pickup", slot: "torch", sprite: "loot-torch", from: { x: 5, y: 6 } },
    ]);
  });

  it("reports nothing across a hub and run transition, or before the first snapshot", () => {
    const hub = view(player({ inventory: [tonic("a")] }), [], [], "hub");
    expect(itemFeedbackEvents(hub, view(player()))).toEqual([]);
    expect(itemFeedbackEvents(view(player({ inventory: [] }), [], [], null), view(player({ inventory: [tonic("a")] })))).toEqual(
      [],
    );
    expect(itemFeedbackEvents(initialSessionView, view(player({ inventory: [tonic("a")] })))).toEqual([]);
  });
});

describe("fly-in start", () => {
  const viewport = { width: 800, height: 600 };

  it("maps a world position the way the renderer does, around the camera at the centre", () => {
    expect(flyInStart({ x: 6, y: 4 }, { x: 5, y: 5 }, viewport, 32)).toEqual({ x: 432, y: 268 });
  });

  it("falls back to the centre when the position is unknown or off-screen", () => {
    expect(flyInStart(null, { x: 5, y: 5 }, viewport, 32)).toEqual({ x: 400, y: 300 });
    expect(flyInStart({ x: 50, y: 5 }, { x: 5, y: 5 }, viewport, 32)).toEqual({ x: 400, y: 300 });
  });
});
