import { bankEntries } from "../../state/hudView.js";
import type { PlayerState } from "../../../shared/types/core.js";

/**
 * The Stash: what survived past escapes, in a panel opened from the camp menu instead of text that
 * is always on screen. Escape or its Close button shuts it. The item slots and torch live in the
 * hotbar.
 */
export function createInventory() {
  const heading = document.createElement("p");
  heading.className = "hud__stash-heading";
  heading.textContent = "Stash";

  const hint = document.createElement("p");
  hint.className = "hud__stash-hint";
  hint.textContent = "Banked this session";

  const bank = document.createElement("ul");
  bank.className = "hud__bank";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "hud__stash-close";
  closeButton.textContent = "Close";

  const header = document.createElement("div");
  header.className = "hud__stash-header";
  header.append(heading, closeButton);

  const panel = document.createElement("section");
  panel.className = "hud__panel hud__stash";
  panel.setAttribute("aria-label", "Stash");
  panel.hidden = true;
  panel.append(header, hint, bank);

  const close = (): void => {
    panel.hidden = true;
  };
  closeButton.addEventListener("click", close);

  return {
    panel,
    close,

    open() {
      panel.hidden = false;
      closeButton.focus();
    },

    isOpen(): boolean {
      return !panel.hidden;
    },

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
