import type { CosmeticSlot } from "../../../shared/types/core.js";
import { createCharacterPreview, drawPartyRing } from "../../rendering/characterPreview.js";
import { CHARACTER_FRAME_HEIGHT, CHARACTER_FRAME_WIDTH, type CharacterLook } from "../../rendering/characters.js";
import { flameHaloTint, flameSwaps } from "../../rendering/flames.js";
import { loadTileset } from "../../rendering/tileset.js";
import { TRAIL_PIXEL, trailPalette, trailPixels, type TrailSwing } from "../../rendering/trails.js";
import { RARITY_COLOURS, type WardrobeCardView, type WardrobeView } from "../../state/wardrobe.js";

interface WardrobeOptions {
  onBuy: (id: string) => void;
  onEquip: (slot: CosmeticSlot, id: string | null) => void;
}

/** Screen pixels per art pixel in the preview. */
const PREVIEW_SCALE = 6;

/** The trail and flame preview, in art pixels: wide enough for a whole swing. */
const EFFECT_WIDTH = 24;
const EFFECT_HEIGHT = 16;

/**
 * The demonstration swing a trail is tried on: an overhead slash from the hand at the left of the
 * preview. Slower than a real swing, so the trail can be seen; a real one is drawn in the world.
 */
const PREVIEW_PIVOT = { x: 5, y: 13 };
const PREVIEW_SWING = { heading: -0.75, halfArc: 0.85, range: 11 * TRAIL_PIXEL };
const PREVIEW_SWING_MS = 700;
const PREVIEW_CYCLE_MS = 1000;

/** The blade drawn along the slash's leading edge: grip, guard, steel and a bright tip. */
function bladeColour(distance: number): string {
  if (distance < 3) return "#8c6a2a";
  if (distance < 4) return "#4e535a";
  return distance > 10 ? "#e6eaf0" : "#9aa1ab";
}

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

  const effect = document.createElement("canvas");
  effect.className = "hud__wardrobe-preview hud__wardrobe-effect";
  effect.width = EFFECT_WIDTH * PREVIEW_SCALE;
  effect.height = EFFECT_HEIGHT * PREVIEW_SCALE;
  effect.setAttribute("role", "img");
  effect.hidden = true;

  const stage = document.createElement("div");
  stage.className = "hud__wardrobe-stage";
  stage.append(canvas, turnButton, effect);

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
  const tileset = loadTileset(() => paintEffect(performance.now()));

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

  /** What the open tab's slot is showing: the tried-on card, or what is worn. */
  function shownInSlot(): string | null {
    if (trying.has(slot)) return trying.get(slot) ?? null;
    return current?.equipped[slot] ?? null;
  }

  /** A trail on a looping demonstration swing, drawn with the same pixels as the world's. */
  function paintTrail(ctx: CanvasRenderingContext2D, now: number): void {
    const elapsed = now % PREVIEW_CYCLE_MS;
    const progress = Math.min(1, elapsed / PREVIEW_SWING_MS);
    const swing: TrailSwing = {
      ...PREVIEW_SWING,
      origin: { x: PREVIEW_PIVOT.x * TRAIL_PIXEL, y: PREVIEW_PIVOT.y * TRAIL_PIXEL },
      progress,
      seed: Math.floor(now / PREVIEW_CYCLE_MS),
    };
    const palette = trailPalette(shownInSlot());
    if (palette && progress < 1) {
      for (const pixel of trailPixels(swing, palette)) {
        ctx.globalAlpha = pixel.alpha;
        ctx.fillStyle = pixel.colour;
        ctx.fillRect(
          Math.round(pixel.x / TRAIL_PIXEL) * PREVIEW_SCALE,
          Math.round(pixel.y / TRAIL_PIXEL) * PREVIEW_SCALE,
          PREVIEW_SCALE,
          PREVIEW_SCALE,
        );
      }
      ctx.globalAlpha = 1;
    }

    const sweep = Math.min(1, progress * 2);
    const angle = swing.heading - swing.halfArc + swing.halfArc * 2 * sweep;
    for (let distance = 1; distance <= 11; distance += 0.5) {
      ctx.fillStyle = bladeColour(distance);
      ctx.fillRect(
        Math.round(PREVIEW_PIVOT.x + Math.cos(angle) * distance) * PREVIEW_SCALE,
        Math.round(PREVIEW_PIVOT.y + Math.sin(angle) * distance) * PREVIEW_SCALE,
        PREVIEW_SCALE,
        PREVIEW_SCALE,
      );
    }
  }

  /** The torch flame, recoloured exactly as a carried torch is in the world, with its halo. */
  function paintFlame(ctx: CanvasRenderingContext2D): void {
    if (!tileset.ready) return;
    const flameId = shownInSlot();
    const size = EFFECT_HEIGHT * PREVIEW_SCALE;
    const left = (effect.width - size) / 2;
    const tint = flameHaloTint(flameId);
    if (tint) {
      const halo = ctx.createRadialGradient(effect.width / 2, size / 2, 0, effect.width / 2, size / 2, size * 0.6);
      halo.addColorStop(0, tint);
      halo.addColorStop(1, "rgba(0, 0, 0, 0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, effect.width, effect.height);
    }
    tileset.drawSwapped(ctx, "torch-flame", flameId ?? "hearth", flameSwaps(flameId), left, 0, size, size);
  }

  function paintEffect(now: number): void {
    const showing = slot === "trail" || slot === "flame";
    effect.hidden = !showing;
    if (!showing) return;
    effect.setAttribute("aria-label", slot === "trail" ? "The picked trail on a sword swing" : "Your torch in the picked flame");
    const ctx = effect.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, effect.width, effect.height);
    if (slot === "trail") paintTrail(ctx, now);
    else paintFlame(ctx);
  }

  const loop = (now: number): void => {
    paintPreview();
    paintEffect(now);
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
