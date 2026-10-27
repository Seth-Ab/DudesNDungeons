import type { InventoryItem } from "../../shared/types/core.js";

/**
 * The hotbar slot the drop and give keys act on: the last one the player used or tried to use,
 * falling back to the first filled slot when that one is empty. Per page, like key bindings.
 */
let lastUsedSlot = 0;

export function noteSlotUsed(slot: number): void {
  lastUsedSlot = slot;
}

/** What drop and give act on: the selected inventory item, or the hand item when nothing is stowed. */
export function actionableItem(
  inventory: readonly InventoryItem[],
  held: InventoryItem | null,
): InventoryItem | null {
  return selectedItem(inventory) ?? held;
}

export function selectedItem(inventory: readonly InventoryItem[]): InventoryItem | null {
  return inventory[lastUsedSlot] ?? inventory[0] ?? null;
}

/**
 * What the drop key sets down: a carried idol before anything else, since putting it down is how
 * its carrier gets their hands back to fight; otherwise the same item as `actionableItem`.
 */
export function droppableItem(
  inventory: readonly InventoryItem[],
  held: InventoryItem | null,
): InventoryItem | null {
  return carriedIdol(inventory, held) ?? actionableItem(inventory, held);
}

/** The idol a player carries, in a slot or in hand, or null. */
export function carriedIdol(inventory: readonly InventoryItem[], held: InventoryItem | null): InventoryItem | null {
  return [...inventory, held].find((item): item is InventoryItem => item?.kind === "idol") ?? null;
}
