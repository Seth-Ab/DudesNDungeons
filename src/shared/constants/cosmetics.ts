/**
 * Cosmetics (decision 0014, #128): permanent profile unlocks that change how a player looks and
 * nothing else. Each item fills one slot, and a player wears at most one item per slot.
 *
 * The slots are shared so a client sends only a slot the server knows. Weapon trails and torch
 * flames join them later (#138); adding a slot is a protocol change.
 */
export const COSMETIC_SLOTS = ["hat", "cloak", "dye"] as const;

/** How rare an item is, which is what colours its wardrobe card. Presentation only. */
export const COSMETIC_RARITIES = ["common", "fine", "rare", "legendary"] as const;

