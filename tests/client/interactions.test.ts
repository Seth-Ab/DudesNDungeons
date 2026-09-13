import { describe, expect, it } from "vitest";
import { nearestInteraction, planUse } from "../../src/client/state/gameState.js";
import { MAX_INVENTORY_SIZE, PLAYER_MAX_HEALTH } from "../../src/shared/constants/game.js";
import type { DungeonState, InventoryItem, PlayerState } from "../../src/shared/types/core.js";

const KEY: InventoryItem = { id: "33333333-3333-4333-8333-333333333333", name: "Copper Key", kind: "key" };
const TONIC: InventoryItem = {
  id: "44444444-4444-4444-8444-444444444444",
  name: "Minor Tonic",
  kind: "tonic",
};
const DOOR_ID = "55555555-5555-4555-8555-555555555555";
const EXIT_ID = "66666666-6666-4666-8666-666666666666";

// Tonic at (1, 1), key at (2, 1), locked door at (4, 1), exit at (6, 1).
function dungeon(overrides: Partial<DungeonState> = {}): DungeonState {
  return {
    map: { id: "test", name: "Test", width: 8, height: 3, tiles: ["########", "#......#", "########"] },
    monsters: [],
    loot: [
      { ...TONIC, position: { x: 1, y: 1 }, pickedUp: false },
      { ...KEY, position: { x: 2, y: 1 }, pickedUp: false },
    ],
    doors: [{ id: DOOR_ID, position: { x: 4, y: 1 }, open: false, locked: true }],
    exits: [{ id: EXIT_ID, position: { x: 6, y: 1 }, destination: "deeper vault" }],
    cleared: false,
    ...overrides,
  };
}

function self(overrides: Partial<PlayerState> = {}): PlayerState {
  return {
    id: "8f1d6b0e-6a4a-4f2e-9d1c-2b3a4c5d6e7f",
    name: "Self",
    position: { x: 0, y: 0 },
    facing: { x: 0, y: 1 },
    health: PLAYER_MAX_HEALTH,
    ready: false,
    connected: true,
    inventory: [],
    ...overrides,
  };
}

describe("nearestInteraction", () => {
  it("offers loot in reach", () => {
    expect(nearestInteraction(dungeon(), self(), { x: 2.5, y: 1 })).toEqual({
      action: "pickup",
      targetId: KEY.id,
      position: { x: 2, y: 1 },
      label: "Pick up Copper Key",
      refusal: null,
    });
  });

  it("picks the nearest of several candidates", () => {
    expect(nearestInteraction(dungeon(), self(), { x: 1.2, y: 1 })?.targetId).toBe(TONIC.id);
  });

  it("offers nothing when everything is out of reach or already taken", () => {
    const taken = dungeon({
      loot: dungeon().loot.map((loot) => ({ ...loot, pickedUp: true })),
    });

    expect(nearestInteraction(taken, self(), { x: 2.5, y: 1 })).toBeNull();
  });

  it("explains a locked door to a player without a key", () => {
    expect(nearestInteraction(dungeon(), self(), { x: 3.5, y: 1 })).toMatchObject({
      action: "interact",
      targetId: DOOR_ID,
      label: "Locked door",
      refusal: "Locked. Find a key to open it.",
    });
  });

  it("offers to unlock the door with a carried key", () => {
    expect(nearestInteraction(dungeon(), self({ inventory: [KEY] }), { x: 3.5, y: 1 })).toMatchObject({
      label: "Unlock with Copper Key",
      refusal: null,
    });
  });

  it("offers to open an unlocked door, and nothing for an open one", () => {
    const unlocked = dungeon({ doors: [{ id: DOOR_ID, position: { x: 4, y: 1 }, open: false, locked: false }] });
    const open = dungeon({ doors: [{ id: DOOR_ID, position: { x: 4, y: 1 }, open: true, locked: false }] });

    expect(nearestInteraction(unlocked, self(), { x: 3.5, y: 1 })?.label).toBe("Open door");
    expect(nearestInteraction(open, self(), { x: 3.5, y: 1 })).toBeNull();
  });

  it("refuses loot when the pack is full", () => {
    const full = self({ inventory: Array.from({ length: MAX_INVENTORY_SIZE }, () => TONIC) });

    expect(nearestInteraction(dungeon(), full, { x: 2.5, y: 1 })?.refusal).toBe("Your pack is full.");
  });

  it("offers the exit until the dungeon is cleared", () => {
    expect(nearestInteraction(dungeon(), self(), { x: 6, y: 1 })?.label).toBe("Take the exit");
    expect(nearestInteraction(dungeon({ cleared: true }), self(), { x: 6, y: 1 })).toBeNull();
  });
});

describe("planUse", () => {
  it("drinks a tonic when hurt", () => {
    expect(planUse(self({ health: 40 }), TONIC)).toEqual({ itemId: TONIC.id });
  });

  it("refuses a tonic at full health", () => {
    expect(planUse(self(), TONIC)).toEqual({ refusal: "Already at full health." });
  });

  it("points keys at doors instead of using them", () => {
    expect(planUse(self({ health: 40 }), KEY)).toEqual({
      refusal: "Keys open doors. Stand by one and press E.",
    });
  });

  it("explains an empty slot, with a caller-specific message when given", () => {
    expect(planUse(self(), undefined)).toEqual({ refusal: "Nothing in that slot." });
    expect(planUse(self(), undefined, "No tonic to drink.")).toEqual({ refusal: "No tonic to drink." });
  });
});
