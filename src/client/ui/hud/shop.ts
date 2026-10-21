import type { SkillShopView } from "../../state/skillShop.js";

interface ShopOptions {
  onBuy: (itemId: string) => void;
}

/**
 * The scroll shop panel at the Scrolls stall: the room's stock with prices, the player's coin, a
 * Buy button per entry, and the server's last refusal inline. Opened by interacting inside the
 * shop area and shut by Escape, its Close button, or walking out. The server decides every
 * purchase; the list only shows what its last `skillShopStock` and `progressionUpdated` said.
 */
export function createShop(options: ShopOptions) {
  const heading = document.createElement("p");
  heading.className = "hud__stash-heading";
  heading.textContent = "Scrolls";

  const coin = document.createElement("p");
  coin.className = "hud__stash-hint hud__shop-coin";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "hud__stash-close";
  closeButton.textContent = "Close";

  const header = document.createElement("div");
  header.className = "hud__stash-header";
  header.append(heading, closeButton);

  const list = document.createElement("ul");
  list.className = "hud__vault-list";
  list.setAttribute("aria-label", "Scrolls for sale");

  const notice = document.createElement("p");
  notice.className = "hud__stash-hint hud__shop-notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;

  const panel = document.createElement("section");
  panel.className = "hud__panel hud__vault hud__shop";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Scroll shop");
  panel.hidden = true;
  panel.append(header, coin, list, notice);

  const close = (): void => {
    panel.hidden = true;
  };
  closeButton.addEventListener("click", close);

  /** The last stock drawn, so a snapshot that changed nothing leaves the buttons (and focus) alone. */
  let drawn = "";

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

    update(view: SkillShopView) {
      coin.textContent = `Your coin: ${view.coin}`;
      notice.hidden = view.notice === null;
      notice.textContent = view.notice ?? "";

      const next = JSON.stringify(view.entries);
      if (next === drawn) return;
      drawn = next;

      if (view.entries.length === 0) {
        const empty = document.createElement("li");
        empty.className = "hud__bank-entry hud__bank-entry--empty";
        empty.textContent = "Nothing for sale right now";
        list.replaceChildren(empty);
        return;
      }

      list.replaceChildren(
        ...view.entries.map((entry) => {
          const item = document.createElement("li");
          item.className = "hud__vault-entry hud__shop-entry";
          const label = document.createElement("span");
          const title = document.createElement("strong");
          title.textContent = `${entry.name} - ${entry.price} coin`;
          label.append(title);
          for (const line of [
            entry.rotating ? "Rotating stock" : "",
            entry.description,
            entry.note ?? "",
          ]) {
            if (line === "") continue;
            const detail = document.createElement("small");
            detail.className = "hud__shop-detail";
            detail.textContent = line;
            label.append(document.createElement("br"), detail);
          }
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = "Buy";
          button.setAttribute("aria-label", `Buy ${entry.name} for ${entry.price} coin`);
          button.addEventListener("click", () => options.onBuy(entry.itemId));
          item.append(label, button);
          return item;
        }),
      );
    },
  };
}
