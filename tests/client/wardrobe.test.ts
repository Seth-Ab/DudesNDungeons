import { describe, expect, it } from "vitest";
import {
  applyServerMessage,
  emptyProgression,
  initialSessionView,
  type SessionView,
} from "../../src/client/network/sessionState.js";
import { wardrobeRejectionMessage } from "../../src/client/state/runFlow.js";
import { wardrobeView } from "../../src/client/state/wardrobe.js";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import type { WardrobeEntry } from "../../src/shared/protocol/index.js";
import type { EquippedCosmetics, PlayerState } from "../../src/shared/types/core.js";

const SELF_ID = "8f1d6b0e-6a4a-4f2e-9d1c-2b3a4c5d6e7f";

function entry(overrides: Partial<WardrobeEntry> & Pick<WardrobeEntry, "id" | "slot">): WardrobeEntry {
  return {
    rarity: "common",
    name: overrides.id,
    lore: "Lore.",
    starter: false,
    price: null,
    milestone: null,
    rotating: false,
    inStock: false,
    ...overrides,
  };
}

const CATALOGUE: WardrobeEntry[] = [
  entry({ id: "leather-cap", slot: "hat", starter: true }),
  entry({ id: "feathered-cap", slot: "hat", rarity: "fine", price: 30, inStock: true }),
  entry({ id: "wizard-hat", slot: "hat", rarity: "rare", price: 50, rotating: true, inStock: false }),
  entry({ id: "iron-helm", slot: "hat", rarity: "rare", milestone: { stat: "emberWardenKills", threshold: 1 } }),
  entry({ id: "traveler-cape", slot: "cloak", starter: true }),
  entry({ id: "bone-dye", slot: "dye", price: 15, inStock: true }),
];

function self(cosmetics: EquippedCosmetics): PlayerState {
  return {
    id: SELF_ID,
    name: "Hero",
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
    cosmetics,
  };
}

function view(cosmetics: EquippedCosmetics = { hat: null, cloak: null, dye: null, trail: null, flame: null }, owned: string[] = []): SessionView {
  return {
    ...initialSessionView,
    selfId: SELF_ID,
    players: [self(cosmetics)],
    wardrobe: CATALOGUE,
    progression: { ...emptyProgression, coin: 40, ownedCosmeticIds: owned },
  };
}

const card = (wardrobe: ReturnType<typeof wardrobeView>, slot: string, id: string | null) =>
  wardrobe.tabs.find((tab) => tab.slot === slot)!.cards.find((candidate) => candidate.id === id)!;

describe("the wardrobe view", () => {
  it("has a tab per slot, each led by a card for wearing nothing", () => {
    const wardrobe = wardrobeView(view());

    expect(wardrobe.tabs.map((tab) => tab.label)).toEqual(["Hats", "Cloaks", "Outfit dyes", "Weapon trails", "Torch flames"]);
    expect(wardrobe.tabs.map((tab) => tab.cards[0]!.name)).toEqual([
      "No hat",
      "No cloak",
      "Party colour",
      "No trail",
      "Hearth Flame",
    ]);
    expect(wardrobe.coin).toBe(40);
  });

  it("offers to wear a starter, buy what is in stock, and nothing for what cannot be had here", () => {
    const wardrobe = wardrobeView(view());

    expect(card(wardrobe, "hat", "leather-cap")).toMatchObject({ owned: true, action: "equip", how: [] });
    expect(card(wardrobe, "hat", "feathered-cap")).toMatchObject({ owned: false, action: "buy", price: 30 });
    expect(card(wardrobe, "hat", "wizard-hat")).toMatchObject({
      action: "none",
      how: ["Wardrobe stall: 50 coin, not in stock this run"],
    });
    expect(card(wardrobe, "hat", "iron-helm")).toMatchObject({
      action: "none",
      how: ["Milestone: reach 1 Ember Warden kills (0/1)"],
    });
  });

  it("marks what is worn, offers to take it off, and lets the empty card clear the slot", () => {
    const wardrobe = wardrobeView(view({ hat: "feathered-cap", cloak: null, dye: null, trail: null, flame: null }, ["feathered-cap"]));

    expect(card(wardrobe, "hat", "feathered-cap")).toMatchObject({ equipped: true, action: "unequip" });
    expect(card(wardrobe, "hat", null)).toMatchObject({ equipped: false, action: "equip" });
    expect(card(wardrobe, "cloak", null)).toMatchObject({ equipped: true, action: "none" });
    expect(wardrobe.equipped).toEqual({ hat: "feathered-cap", cloak: null, dye: null, trail: null, flame: null });
  });

  it("folds in the catalogue, ownership and the server's refusal", () => {
    let next = applyServerMessage(initialSessionView, { type: "wardrobeCatalog", entries: CATALOGUE });
    expect(next.wardrobe).toEqual(CATALOGUE);

    next = applyServerMessage(next, {
      type: "progressionUpdated",
      skillStacks: {},
      runSkillStacks: {},
      activeSkillStacks: {},
      coin: 5,
      runCoin: 0,
      stats: emptyProgression.stats,
      earnedMilestones: [],
      ownedCosmeticIds: ["leather-cap", "traveler-cape", "bone-dye"],
    });
    expect(next.progression?.ownedCosmeticIds).toContain("bone-dye");

    expect(wardrobeView({ ...view(), wardrobeNotice: "Not enough coin." }).notice).toBe("Not enough coin.");
  });

  it("words a refusal for a cosmetic rather than a scroll", () => {
    expect(wardrobeRejectionMessage("outOfStock")).toBe("The stall is not selling that right now.");
    expect(wardrobeRejectionMessage("notOwned")).toBe("You do not own that yet.");
    expect(wardrobeRejectionMessage("insufficientCoin")).toBe("Not enough coin.");
  });
});
