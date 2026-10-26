import { describe, expect, it } from "vitest";
import {
  emptyProgression,
  initialSessionView,
  type ProgressionView,
  type SessionView,
} from "../../src/client/network/sessionState.js";
import { skillsPanelView } from "../../src/client/state/skillsView.js";
import { DEFAULT_APPEARANCE } from "../../src/shared/constants/appearance.js";
import type { InventoryItem, PlayerState, SkillView } from "../../src/shared/types/core.js";

const SELF_ID = "8f1d6b0e-6a4a-4f2e-9d1c-2b3a4c5d6e7f";

function skill(overrides: Partial<SkillView> & Pick<SkillView, "id" | "name">): SkillView {
  return {
    description: `${overrides.name} description.`,
    effects: [{ type: "resistanceBonus", amount: 10 }],
    maxStacks: 1,
    requires: [],
    conversionCoin: 3,
    stackEffects: [],
    perStackEffects: [],
    ...overrides,
  };
}

const IRON_WILL = skill({
  id: "iron-will",
  name: "Iron Will",
  maxStacks: 3,
  stackEffects: [
    [{ type: "resistanceBonus", amount: 5 }],
    [{ type: "resistanceBonus", amount: 5 }],
  ],
});
const TORCHBEARER = skill({
  id: "torchbearer",
  name: "Torchbearer",
  effects: [{ type: "sightRadiusBonus", amount: 1.5 }],
});
const QUICK_HANDS = skill({
  id: "quick-hands",
  name: "Quick Hands",
  effects: [{ type: "attackDamageBonus", amount: 2 }],
  maxStacks: null,
  perStackEffects: [{ type: "attackDamageBonus", amount: 1 }],
});
const SHADOW_STEP = skill({
  id: "shadow-step",
  name: "Shadow Step",
  requires: ["torchbearer"],
});

function progression(overrides: Partial<ProgressionView> = {}): ProgressionView {
  return {
    ...emptyProgression,
    skills: [IRON_WILL, TORCHBEARER, QUICK_HANDS, SHADOW_STEP],
    milestones: [
      {
        id: "seasoned-escapee",
        name: "Seasoned Escapee",
        stat: "runsEscaped",
        threshold: 5,
        skillId: "shadow-step",
      },
    ],
    ...overrides,
  };
}

function scroll(id: string, skillId: string): InventoryItem {
  return { id, name: `Scroll of ${skillId}`, kind: "skillScroll", skillId };
}

function self(inventory: InventoryItem[]): PlayerState {
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
    inventory,
    held: null,
    drawFraction: null,
    drawRange: null,
    carryingTorch: false,
    carryingPlayerId: null,
    carriedByPlayerId: null,
    seatId: null,
    readyPlateId: null,
    appearance: { ...DEFAULT_APPEARANCE },
    partyColor: "ember",
    cosmetics: { hat: null, cloak: null, dye: null, trail: null, flame: null },
    bankedItems: [],
  };
}

function view(
  state: ProgressionView | null,
  extra: { inventory?: InventoryItem[]; vault?: InventoryItem[] } = {},
): SessionView {
  return {
    ...initialSessionView,
    selfId: SELF_ID,
    players: [self(extra.inventory ?? [])],
    vault: extra.vault ?? [],
    progression: state,
  };
}

function entry(panel: ReturnType<typeof skillsPanelView>, id: string) {
  const found = panel.skills.find((candidate) => candidate.skillId === id);
  if (!found) throw new Error(`no entry for ${id}`);
  return found;
}

describe("skills panel", () => {
  it("waits for the catalog and shows nothing invented before it arrives", () => {
    expect(skillsPanelView(view(null))).toEqual({ ready: false, skills: [], scrolls: [], coin: 0, runCoin: 0 });
    expect(skillsPanelView(view(emptyProgression)).ready).toBe(false);
  });

  it("shows a skill never held as locked, with how it is earned", () => {
    const panel = skillsPanelView(view(progression()));
    expect(entry(panel, "torchbearer")).toMatchObject({
      status: "locked",
      stackText: null,
      currentEffect: null,
      nextEffect: null,
      missingPrerequisites: [],
    });
    expect(entry(panel, "torchbearer").acquisition).toEqual(["Found as a skill scroll in the dungeon"]);
  });

  describe("the hub shop's price for a locked skill", () => {
    const stocked = (skillId: string, price: number, rotating: boolean) => ({
      itemId: `${skillId}-scroll`,
      name: `Scroll of ${skillId}`,
      skillId,
      price,
      rotating,
    });
    const shopView = (shop: { stock: ReturnType<typeof stocked>[]; rotating: string[] }) => ({
      ...view(progression()),
      skillShop: shop.stock,
      skillShopRotating: shop.rotating,
    });

    it("shows the server's price for a fixed scroll", () => {
      const panel = skillsPanelView(shopView({ stock: [stocked("torchbearer", 25, false)], rotating: [] }));
      expect(entry(panel, "torchbearer").shopText).toBe("Sold at the hub shop - 25 coin");
    });

    it("shows the price for a rotating scroll that is in stock", () => {
      const panel = skillsPanelView(
        shopView({ stock: [stocked("quick-hands", 40, true)], rotating: ["quick-hands", "shadow-step"] }),
      );
      expect(entry(panel, "quick-hands").shopText).toBe("Sold at the hub shop - 40 coin (rotating stock)");
    });

    it("shows no number for a rotating scroll that is out of stock", () => {
      const panel = skillsPanelView(
        shopView({ stock: [stocked("quick-hands", 40, true)], rotating: ["quick-hands", "shadow-step"] }),
      );
      expect(entry(panel, "shadow-step").shopText).toBe("Sometimes sold at the hub shop");
    });

    it("says nothing for a scroll the shop never lists, and for a held skill", () => {
      const panel = skillsPanelView({
        ...shopView({ stock: [stocked("torchbearer", 25, false)], rotating: [] }),
        progression: progression({ skillStacks: { torchbearer: 1 }, activeSkillStacks: { torchbearer: 1 } }),
      });
      expect(entry(panel, "iron-will").shopText).toBeNull();
      expect(entry(panel, "torchbearer").shopText).toBeNull();
    });

    it("keeps the unmet prerequisites beside the price", () => {
      const panel = skillsPanelView(shopView({ stock: [stocked("shadow-step", 60, false)], rotating: [] }));
      expect(entry(panel, "shadow-step")).toMatchObject({
        missingPrerequisites: ["Torchbearer"],
        shopText: "Sold at the hub shop - 60 coin",
      });
    });
  });

  it("marks a locked skill with a missing prerequisite unavailable and names the prerequisite and milestone", () => {
    const shadow = entry(skillsPanelView(view(progression())), "shadow-step");
    expect(shadow.status).toBe("unavailable");
    expect(shadow.missingPrerequisites).toEqual(["Torchbearer"]);
    expect(shadow.acquisition).toContain(
      "Milestone Seasoned Escapee: reach 5 escaped runs to earn Shadow Step",
    );
  });

  it("makes the prerequisite satisfied by a provisional stack, and drops an earned milestone from the list", () => {
    const panel = skillsPanelView(
      view(
        progression({
          runSkillStacks: { torchbearer: 1 },
          activeSkillStacks: { torchbearer: 1 },
          earnedMilestones: ["seasoned-escapee"],
        }),
      ),
    );
    const shadow = entry(panel, "shadow-step");
    expect(shadow.status).toBe("locked");
    expect(shadow.acquisition).toEqual(["Found as a skill scroll in the dungeon"]);
  });

  it("tells a provisional skill from a permanent one and resolves its effect", () => {
    const panel = skillsPanelView(
      view(
        progression({
          skillStacks: { "iron-will": 1 },
          runSkillStacks: { torchbearer: 1 },
          activeSkillStacks: { "iron-will": 1, torchbearer: 1 },
        }),
      ),
    );
    expect(entry(panel, "iron-will")).toMatchObject({
      status: "permanent",
      currentEffect: "+10 resistance",
      nextEffect: "+5 resistance",
      stackText: "1/3",
    });
    expect(entry(panel, "torchbearer")).toMatchObject({
      status: "provisional",
      currentEffect: "+1.5 sight radius",
      stackText: null,
      nextEffect: null,
    });
    expect(panel.skills.map((candidate) => candidate.status).slice(0, 2)).toEqual(["permanent", "provisional"]);
  });

  it("sums an upgraded capped skill and stops offering a next stack at the limit", () => {
    const panel = skillsPanelView(
      view(progression({ skillStacks: { "iron-will": 2 }, runSkillStacks: { "iron-will": 1 }, activeSkillStacks: { "iron-will": 3 } })),
    );
    expect(entry(panel, "iron-will")).toMatchObject({
      status: "permanent",
      permanentStacks: 2,
      runStacks: 1,
      stackText: "3/3",
      currentEffect: "+20 resistance",
      nextEffect: null,
    });
  });

  it("shows only the count for an unlimited skill, with its per-stack effect", () => {
    const panel = skillsPanelView(
      view(progression({ skillStacks: { "quick-hands": 4 }, activeSkillStacks: { "quick-hands": 4 } })),
    );
    expect(entry(panel, "quick-hands")).toMatchObject({
      stackText: "4",
      currentEffect: "+5 attack damage",
      nextEffect: "+1 attack damage",
    });
  });

  it("flags scrolls that cannot be used yet and offers conversion only for a carried maxed one", () => {
    const panel = skillsPanelView(
      view(progression({ skillStacks: { torchbearer: 1, "iron-will": 3 }, activeSkillStacks: { torchbearer: 1, "iron-will": 3 } }), {
        inventory: [scroll("a1", "iron-will"), scroll("a2", "quick-hands")],
        vault: [scroll("b1", "iron-will")],
      }),
    );
    expect(panel.scrolls.map(({ itemId, state, where, canConvert }) => ({ itemId, state, where, canConvert }))).toEqual([
      { itemId: "a1", state: "maxed", where: "carried", canConvert: true },
      { itemId: "b1", state: "maxed", where: "vault", canConvert: false },
    ]);
    expect(panel.scrolls[0]?.text).toContain("Convert to 3 coin");
  });

  it("reads a scroll with missing prerequisites as blocked, even in the vault", () => {
    const panel = skillsPanelView(
      view(progression(), { inventory: [scroll("a1", "shadow-step")], vault: [scroll("b1", "shadow-step")] }),
    );
    expect(panel.scrolls.map(({ state, canConvert }) => [state, canConvert])).toEqual([
      ["blocked", false],
      ["blocked", false],
    ]);
    expect(panel.scrolls[0]?.text).toBe("Cannot be used yet: needs Torchbearer");
  });

  it("does not list a usable scroll, a non-stacking maxed scroll counts as maxed, and an unknown skill is skipped", () => {
    const panel = skillsPanelView(
      view(progression({ skillStacks: { torchbearer: 1 }, activeSkillStacks: { torchbearer: 1 } }), {
        inventory: [scroll("a1", "iron-will"), scroll("a2", "torchbearer"), scroll("a3", "gone")],
      }),
    );
    expect(panel.scrolls.map((candidate) => [candidate.itemId, candidate.state])).toEqual([["a2", "maxed"]]);
  });

  it("carries the server's coin balances through unchanged", () => {
    const panel = skillsPanelView(view(progression({ coin: 12, runCoin: 3 })));
    expect([panel.coin, panel.runCoin]).toEqual([12, 3]);
  });
});
