import type { VaultEntryView } from "../../state/hudView.js";

interface VaultOptions {
  onWithdraw: (itemId: string) => void;
  onDeposit: (itemId: string) => void;
}

/**
 * The party vault panel at the Bank stall: what the party has stored, each with a Take button, and
 * what this player carries, each with a Store button. Opened by interacting inside the vault area,
 * and shut by Escape, its Close button, or walking out of the area. The server decides every take
 * and store; the lists only ever show what its last `partyVault` and snapshot said.
 */
export function createVault(options: VaultOptions) {
  const heading = document.createElement("p");
  heading.className = "hud__stash-heading";
  heading.textContent = "Party Vault";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "hud__stash-close";
  closeButton.textContent = "Close";

  const header = document.createElement("div");
  header.className = "hud__stash-header";
  header.append(heading, closeButton);

  const vaultHint = document.createElement("p");
  vaultHint.className = "hud__stash-hint";
  vaultHint.textContent = "Shared with the party";
  const vaultList = document.createElement("ul");
  vaultList.className = "hud__vault-list";
  vaultList.setAttribute("aria-label", "In the vault");

  const carriedHint = document.createElement("p");
  carriedHint.className = "hud__stash-hint";
  carriedHint.textContent = "You carry";
  const carriedList = document.createElement("ul");
  carriedList.className = "hud__vault-list";
  carriedList.setAttribute("aria-label", "You carry");

  const panel = document.createElement("section");
  panel.className = "hud__panel hud__vault";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Party Vault");
  panel.hidden = true;
  panel.append(header, vaultHint, vaultList, carriedHint, carriedList);

  const close = (): void => {
    panel.hidden = true;
  };
  closeButton.addEventListener("click", close);

  /** The last lists drawn, so a snapshot that changed nothing leaves the buttons (and focus) alone. */
  let drawn = "";

  const fill = (
    list: HTMLUListElement,
    entries: readonly VaultEntryView[],
    empty: string,
    action: string,
    onPick: (itemId: string) => void,
  ): void => {
    if (entries.length === 0) {
      const item = document.createElement("li");
      item.className = "hud__bank-entry hud__bank-entry--empty";
      item.textContent = empty;
      list.replaceChildren(item);
      return;
    }

    list.replaceChildren(
      ...entries.map((entry) => {
        const item = document.createElement("li");
        item.className = "hud__vault-entry";
        const name = document.createElement("span");
        name.textContent = entry.text;
        const button = document.createElement("button");
        button.type = "button";
        button.textContent = action;
        button.setAttribute("aria-label", `${action} ${entry.text}`);
        button.addEventListener("click", () => onPick(entry.itemId));
        item.append(name, button);
        return item;
      }),
    );
  };

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

    update(contents: { vault: VaultEntryView[]; carried: VaultEntryView[] }) {
      const next = JSON.stringify(contents);
      if (next === drawn) return;
      drawn = next;
      fill(vaultList, contents.vault, "Nothing stored yet", "Take", options.onWithdraw);
      fill(carriedList, contents.carried, "Nothing to store", "Store", options.onDeposit);
    },
  };
}
