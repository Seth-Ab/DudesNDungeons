import { bankEntries } from "../../state/hudView.js";
import type { PlayerState } from "../../../shared/types/core.js";

/**
 * The Stash: what survived past escapes, in a panel a button toggles instead of text that is
 * always on screen. The item slots and torch live in the hotbar.
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

  const panel = document.createElement("section");
  panel.className = "hud__panel hud__stash";
  panel.hidden = true;
  panel.append(heading, hint, bank);

  const toggle = document.createElement("button");
  toggle.type = "button";
  toggle.textContent = "Stash";
  toggle.setAttribute("aria-expanded", "false");

  const setOpen = (open: boolean): void => {
    panel.hidden = !open;
    toggle.setAttribute("aria-expanded", `${open}`);
  };
  toggle.addEventListener("click", () => setOpen(panel.hidden));

  return {
    panel,
    toggle,

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
