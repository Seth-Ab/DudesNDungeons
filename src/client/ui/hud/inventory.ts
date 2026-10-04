import { bankEntries } from "../../state/hudView.js";
import type { PlayerState } from "../../../shared/types/core.js";

/** The bank panel; the item slots and torch live in the hotbar. */
export function createInventory() {
  const bankHeading = document.createElement("p");
  bankHeading.className = "hud__bank-heading";
  bankHeading.textContent = "Banked this session";

  const bank = document.createElement("ul");
  bank.className = "hud__bank";

  return {
    // Appended in this order by the HUD: bank heading, bank.
    bankElements: [bankHeading, bank] as const,

    update(self: PlayerState | null) {
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
