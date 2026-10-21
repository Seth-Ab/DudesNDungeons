import { type SessionView } from "../network/sessionState.js";

/** One line of the shop panel. The price is the server's, and the Buy button names `itemId`. */
export interface SkillShopEntryView {
  itemId: string;
  name: string;
  description: string;
  price: number;
  rotating: boolean;
  /** Shown beside the entry when the buyer cannot use the scroll yet or has no use for it. */
  note: string | null;
}

export interface SkillShopView {
  coin: number;
  entries: SkillShopEntryView[];
  notice: string | null;
}

/**
 * What the shop panel lists: the server's current stock with each skill's description and a note
 * for a scroll the buyer cannot use yet (missing prerequisites; still buyable, per decision 0014)
 * or whose skill they already have at its limit (the server will refuse it). Only informs; the
 * server judges every purchase.
 */
export function skillShopView(view: SessionView): SkillShopView {
  const progression = view.progression;
  const held = (skillId: string): number =>
    (progression?.skillStacks[skillId] ?? 0) + (progression?.runSkillStacks[skillId] ?? 0);

  const entries = view.skillShop.map((entry): SkillShopEntryView => {
    const skill = progression?.skills.find((candidate) => candidate.id === entry.skillId);
    let note: string | null = null;
    if (skill) {
      const missing = skill.requires
        .filter((requiredId) => held(requiredId) < 1)
        .map((requiredId) => progression?.skills.find((candidate) => candidate.id === requiredId)?.name ?? requiredId);
      if (skill.maxStacks !== null && held(skill.id) >= skill.maxStacks) note = "Already maxed";
      else if (missing.length > 0) note = `Needs ${missing.join(", ")} to use`;
    }
    return {
      itemId: entry.itemId,
      name: entry.name,
      description: skill?.description ?? "",
      price: entry.price,
      rotating: entry.rotating,
      note,
    };
  });

  return { coin: progression?.coin ?? 0, entries, notice: view.shopNotice };
}
