import { COSMETIC_SLOTS } from "../../shared/constants/cosmetics.js";
import type { WardrobeEntry } from "../../shared/protocol/index.js";
import { NO_COSMETICS, type CosmeticRarity, type CosmeticSlot, type EquippedCosmetics } from "../../shared/types/core.js";
import { selfOf, type SessionView } from "../network/sessionState.js";
import { MILESTONE_STAT_LABELS } from "./skillsView.js";

/** Each slot's tab label. */
export const WARDROBE_TAB_LABELS: Record<CosmeticSlot, string> = {
  hat: "Hats",
  cloak: "Cloaks",
  dye: "Outfit dyes",
  trail: "Weapon trails",
  flame: "Torch flames",
};

/** A card's border and rarity line, from the sprite bible's `RARITY`. */
export const RARITY_COLOURS: Record<CosmeticRarity, string> = {
  common: "#9aa3ad",
  fine: "#63bb86",
  rare: "#8fa8d6",
  legendary: "#f0a83c",
};

/**
 * What a card's button does. `buy` and `equip` send an intent; `unequip` takes the slot off; `none`
 * is an item that cannot be had right now, by this player, here.
 */
export type WardrobeAction = "buy" | "equip" | "unequip" | "none";

export interface WardrobeCardView {
  /** The cosmetic id, or null for the slot's empty card ("No hat", "Party colour"). */
  id: string | null;
  name: string;
  lore: string;
  rarity: CosmeticRarity;
  /** How it is got, for an item not owned yet; empty once owned. */
  how: string[];
  owned: boolean;
  equipped: boolean;
  action: WardrobeAction;
  /** The button's words, matching `action`. */
  actionLabel: string;
  /** The price when `action` is `buy`, for the button's accessible name. */
  price: number | null;
}

export interface WardrobeView {
  coin: number;
  /** What the player wears now, for the preview. */
  equipped: EquippedCosmetics;
  tabs: { slot: CosmeticSlot; label: string; cards: WardrobeCardView[] }[];
  notice: string | null;
}

/**
 * The card a slot shows for wearing nothing. Always owned; a dye's "nothing" is the party colour and
 * a flame's is the hearth flame every torch starts with.
 */
const EMPTY_CARDS: Record<CosmeticSlot, { name: string; lore: string }> = {
  hat: { name: "No hat", lore: "Just your hair." },
  cloak: { name: "No cloak", lore: "Travel light." },
  dye: { name: "Party colour", lore: "What everyone starts in." },
  trail: { name: "No trail", lore: "Just the swing." },
  flame: { name: "Hearth Flame", lore: "The torch you know." },
};

function howToGet(entry: WardrobeEntry, stats: Record<string, number> | null): string[] {
  const lines: string[] = [];
  if (entry.price !== null) {
    if (entry.inStock) lines.push(`Wardrobe stall: ${entry.price} coin${entry.rotating ? " (rotating stock)" : ""}`);
    else lines.push(`Wardrobe stall: ${entry.price} coin, not in stock this run`);
  }
  if (entry.milestone) {
    const { stat, threshold } = entry.milestone;
    const progress = stats ? ` (${Math.min(stats[stat] ?? 0, threshold)}/${threshold})` : "";
    lines.push(`Milestone: reach ${threshold} ${MILESTONE_STAT_LABELS[stat]}${progress}`);
  }
  return lines;
}

/**
 * What the wardrobe shows: a tab per slot, each with a card for wearing nothing and one per item,
 * the player's coin and what they wear. Only informs: the server judges every buy and equip, and
 * the stock, prices and ownership here are whatever it last said.
 */
export function wardrobeView(view: SessionView): WardrobeView {
  const self = selfOf(view);
  const equipped = self?.cosmetics ?? NO_COSMETICS;
  const progression = view.progression;
  const owned = new Set(progression?.ownedCosmeticIds ?? []);
  const coin = progression?.coin ?? 0;

  const tabs = COSMETIC_SLOTS.map((slot) => {
    const empty = EMPTY_CARDS[slot];
    const wearingNothing = equipped[slot] === null;
    const cards: WardrobeCardView[] = [
      {
        id: null,
        name: empty.name,
        lore: empty.lore,
        rarity: "common",
        how: [],
        owned: true,
        equipped: wearingNothing,
        action: wearingNothing ? "none" : "equip",
        actionLabel: wearingNothing ? "Wearing" : "Wear",
        price: null,
      },
      ...view.wardrobe
        .filter((entry) => entry.slot === slot)
        .map((entry): WardrobeCardView => {
          const isOwned = entry.starter || owned.has(entry.id);
          const isEquipped = equipped[slot] === entry.id;
          const buyable = !isOwned && entry.price !== null && entry.inStock;
          const action: WardrobeAction = isEquipped ? "unequip" : isOwned ? "equip" : buyable ? "buy" : "none";
          return {
            id: entry.id,
            name: entry.name,
            lore: entry.lore,
            rarity: entry.rarity,
            how: isOwned ? [] : howToGet(entry, progression?.stats ?? null),
            owned: isOwned,
            equipped: isEquipped,
            action,
            actionLabel:
              action === "unequip" ? "Take off" : action === "equip" ? "Wear" : action === "buy" ? `Buy, ${entry.price} coin` : "Locked",
            price: action === "buy" ? entry.price : null,
          };
        }),
    ];
    return { slot, label: WARDROBE_TAB_LABELS[slot], cards };
  });

  return { coin, equipped: { ...equipped }, tabs, notice: view.wardrobeNotice };
}
