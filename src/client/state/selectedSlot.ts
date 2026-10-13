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
