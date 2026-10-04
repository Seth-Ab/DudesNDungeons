import { bankEntries, inventorySlotLabels, torchStatusLabel } from "../../state/hudView.js";
import type { PlayerState } from "../../../shared/types/core.js";
import { createStat } from "./dom.js";

/** The item slots, the torch indicator, and the bank panel. */
export function createInventory() {
  const slots = document.createElement("ol");
  slots.className = "hud__inventory";

  const torchStatus = createStat("Torch", "none");

  const bankHeading = document.createElement("p");
  bankHeading.className = "hud__bank-heading";
  bankHeading.textContent = "Banked this session";

  const bank = document.createElement("ul");
  bank.className = "hud__bank";

  return {
    // Appended in this order by the HUD: slots, torch, bank heading, bank.
    elements: [slots, torchStatus.element, bankHeading, bank] as const,

    update(self: PlayerState | null) {
      slots.replaceChildren(
        ...inventorySlotLabels(self?.inventory ?? []).map((label) => {
          const item = document.createElement("li");
          item.className = "hud__inventory-slot";
          item.textContent = label;
          return item;
        }),
      );

      torchStatus.value.textContent = torchStatusLabel(self);

      bank.replaceChildren(
        ...bankEntries(self?.bankedItems ?? []).map((entry) => {
          const item = document.createElement("li");
          item.className = "hud__bank-entry";
          if (entry.empty) item.classList.add("hud__bank-entry--empty");
          item.textContent = entry.text;
          return item;
        }),
      );
    },
  };
}
