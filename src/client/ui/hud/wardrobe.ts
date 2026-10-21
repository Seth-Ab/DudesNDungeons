import type { CosmeticSlot } from "../../../shared/types/core.js";
import { createCharacterPreview, drawPartyRing } from "../../rendering/characterPreview.js";
import { CHARACTER_FRAME_HEIGHT, CHARACTER_FRAME_WIDTH, type CharacterLook } from "../../rendering/characters.js";
import { RARITY_COLOURS, type WardrobeCardView, type WardrobeView } from "../../state/wardrobe.js";

interface WardrobeOptions {
  onBuy: (id: string) => void;
  onEquip: (slot: CosmeticSlot, id: string | null) => void;
}

/** Screen pixels per art pixel in the preview. */
const PREVIEW_SCALE = 6;

/**
 * The wardrobe at the Wardrobe stall: a tab per slot, a card per item with its rarity, how it is
 * got, its price and a button, and a live preview of the player's own character. Picking a card
 * tries it on in the preview without sending anything; its button buys, wears or takes it off,
 * and the server decides each. Opened by interacting at the stall and shut by Escape, its Close
 * button, or walking away.
 */
export function createWardrobe(options: WardrobeOptions) {
  const heading = document.createElement("p");
  heading.className = "hud__stash-heading";
  heading.textContent = "Wardrobe";

  const closeButton = document.createElement("button");
  closeButton.type = "button";
  closeButton.className = "hud__stash-close";
  closeButton.textContent = "Close";

  const header = document.createElement("div");
  header.className = "hud__stash-header";
  header.append(heading, closeButton);

  const coin = document.createElement("p");
  coin.className = "hud__stash-hint hud__shop-coin";

  const canvas = document.createElement("canvas");
  canvas.className = "hud__wardrobe-preview";
  canvas.width = CHARACTER_FRAME_WIDTH * PREVIEW_SCALE;
  canvas.height = CHARACTER_FRAME_HEIGHT * PREVIEW_SCALE;
  canvas.setAttribute("role", "img");
  canvas.setAttribute("aria-label", "Your character wearing the picked items");

  const turnButton = document.createElement("button");
  turnButton.type = "button";
  turnButton.className = "hud__wardrobe-turn";
  turnButton.textContent = "Show back";

  const stage = document.createElement("div");
  stage.className = "hud__wardrobe-stage";
  stage.append(canvas, turnButton);

  const tabList = document.createElement("div");
  tabList.className = "hud__wardrobe-tabs";
  tabList.setAttribute("role", "tablist");
  tabList.setAttribute("aria-label", "Cosmetic slots");

  const cards = document.createElement("ul");
  cards.className = "hud__wardrobe-cards";
  cards.setAttribute("role", "tabpanel");

  const notice = document.createElement("p");
  notice.className = "hud__stash-hint hud__shop-notice";
  notice.setAttribute("role", "status");
  notice.hidden = true;

  const browser = document.createElement("div");
  browser.className = "hud__wardrobe-browser";
  browser.append(tabList, cards, notice);

  const body = document.createElement("div");
  body.className = "hud__wardrobe-body";
  body.append(stage, browser);

  const panel = document.createElement("section");
  panel.className = "hud__panel hud__vault hud__wardrobe";
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Wardrobe");
  panel.hidden = true;
  panel.append(header, coin, body);

  let current: WardrobeView | null = null;
  let look: CharacterLook | null = null;
  let slot: CosmeticSlot = "hat";
  /** What each slot is trying on, by card id; absent means what is worn. */
  const trying = new Map<CosmeticSlot, string | null>();
  let showBack = false;
  let frame = 0;
  let drawn = "";

  const preview = createCharacterPreview(() => paintPreview());

  function previewLook(): CharacterLook | null {
    if (!look || !current) return null;
    const wearing = { ...current.equipped };
    for (const [triedSlot, id] of trying) wearing[triedSlot] = id;
    return { ...look, ...wearing };
  }

  function paintPreview(): void {
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const shown = previewLook();
    if (!shown || !preview.ready) return;
    drawPartyRing(ctx, 8 * PREVIEW_SCALE, 23 * PREVIEW_SCALE, PREVIEW_SCALE, preview.ringColor(shown.partyColor));
    const facing = showBack ? "up" : "down";
    preview.draw(ctx, shown, { facing, mirror: false, pose: "stand", blinking: false }, 0, 0, PREVIEW_SCALE);
  }

  const loop = (): void => {
    paintPreview();
    frame = requestAnimationFrame(loop);
  };

  const close = (): void => {
    panel.hidden = true;
    cancelAnimationFrame(frame);
    trying.clear();
  };
  closeButton.addEventListener("click", close);

  turnButton.addEventListener("click", () => {
    showBack = !showBack;
    turnButton.textContent = showBack ? "Show front" : "Show back";
    paintPreview();
  });

  function card(view: WardrobeCardView): HTMLLIElement {
    const item = document.createElement("li");
    item.className = "hud__wardrobe-card";
    item.style.setProperty("--rarity", RARITY_COLOURS[view.rarity]);
    if (view.equipped) item.classList.add("hud__wardrobe-card--worn");

    const pick = document.createElement("button");
    pick.type = "button";
    pick.className = "hud__wardrobe-pick";
    const tried = trying.has(slot) ? trying.get(slot) : current?.equipped[slot];
    pick.setAttribute("aria-pressed", String(tried === view.id));
    pick.setAttribute("aria-label", `Try on ${view.name}`);
    const name = document.createElement("strong");
    name.textContent = view.name;
    const rarity = document.createElement("small");
    rarity.className = "hud__wardrobe-rarity";
    rarity.textContent = view.id === null ? "" : `${view.rarity}${view.owned ? " · owned" : ""}`;
    const lore = document.createElement("small");
    lore.className = "hud__shop-detail";
    lore.textContent = view.lore;
    pick.append(name, rarity, lore);
    for (const line of view.how) {
      const how = document.createElement("small");
      how.className = "hud__shop-detail hud__wardrobe-how";
      how.textContent = line;
      pick.append(how);
    }
    pick.addEventListener("click", () => {
      trying.set(slot, view.id);
      render(true);
      paintPreview();
    });

    const action = document.createElement("button");
    action.type = "button";
    action.className = "hud__wardrobe-action";
    action.textContent = view.actionLabel;
    action.disabled = view.action === "none";
    action.setAttribute(
      "aria-label",
      view.action === "buy" ? `Buy ${view.name} for ${view.price} coin` : `${view.actionLabel}: ${view.name}`,
    );
    action.addEventListener("click", () => {
      if (view.action === "buy" && view.id !== null) options.onBuy(view.id);
      else if (view.action === "equip") options.onEquip(slot, view.id);
      else if (view.action === "unequip") options.onEquip(slot, null);
      // The worn item is what the preview shows once the server agrees.
      trying.delete(slot);
    });

    item.append(pick, action);
    return item;
  }

  /** Redraws tabs and cards, unless nothing they show changed, so focus survives a snapshot. */
  function render(force = false): void {
    if (!current) return;
    const tab = current.tabs.find((candidate) => candidate.slot === slot) ?? current.tabs[0];
    if (!tab) return;
    const next = JSON.stringify([slot, current.tabs, [...trying]]);
    if (!force && next === drawn) return;
    drawn = next;

    const focusedLabel = document.activeElement instanceof HTMLElement && panel.contains(document.activeElement)
      ? document.activeElement.getAttribute("aria-label")
      : null;

    tabList.replaceChildren(
      ...current.tabs.map((candidate) => {
        const button = document.createElement("button");
        button.type = "button";
        button.className = "hud__wardrobe-tab";
        button.setAttribute("role", "tab");
        button.setAttribute("aria-selected", String(candidate.slot === slot));
        button.textContent = candidate.label;
        button.addEventListener("click", () => {
          slot = candidate.slot;
          render(true);
        });
        return button;
      }),
    );
    cards.setAttribute("aria-label", tab.label);
    cards.replaceChildren(...tab.cards.map(card));

    if (focusedLabel) {
      const again = [...panel.querySelectorAll<HTMLElement>("button")].find(
        (button) => button.getAttribute("aria-label") === focusedLabel,
      );
      again?.focus();
    }
  }

  return {
    panel,
    close,

    open() {
      panel.hidden = false;
      closeButton.focus();
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(loop);
    },

    isOpen(): boolean {
      return !panel.hidden;
    },

    /** `self` is the player's look without cosmetics, which the preview dresses. */
    update(view: WardrobeView, self: CharacterLook | null) {
      current = view;
      look = self;
      coin.textContent = `Your coin: ${view.coin}`;
      notice.hidden = view.notice === null;
      notice.textContent = view.notice ?? "";
      render();
    },
  };
}
