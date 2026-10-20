import type { FeedbackSlot, ItemFeedbackEvent } from "../../state/itemFeedback.js";
import { flyInStart } from "../../state/itemFeedback.js";
import { pixelsPerWorldUnit } from "../../rendering/canvasRenderer.js";
import type { SpriteName } from "../../rendering/tiles.js";
import type { Vector2 } from "../../../shared/types/core.js";
import { paintIcon } from "./hotbar.js";

const PULSE_CLASS = "hud__slot--pulse";
/** Longer than either animation in the stylesheet, so a missed `animationend` still cleans up. */
const CLEANUP_MS = 900;

function reducedMotion(): boolean {
  return document.documentElement.dataset.reducedMotion === "true";
}

/**
 * Plays slot feedback: a pulse on the slot an item was used from, and an icon flying from where an
 * item was picked up into the slot that took it. Both are decoration on top of the HUD: they ignore
 * the pointer and are never waited on. With reduced motion on, both are the same instant highlight.
 */
export function createItemFeedback(layer: HTMLElement, slotElement: (slot: FeedbackSlot) => HTMLElement | null) {
  // One pending cleanup per slot, so an earlier pulse's timer cannot cut a newer one short.
  const pulseTimers = new Map<HTMLElement, number>();

  const pulse = (slot: FeedbackSlot): void => {
    const element = slotElement(slot);
    if (!element) return;
    window.clearTimeout(pulseTimers.get(element));
    element.classList.remove(PULSE_CLASS);
    // Reading layout restarts the animation when the same slot pulses twice in a row.
    void element.offsetWidth;
    element.classList.add(PULSE_CLASS);
    pulseTimers.set(
      element,
      window.setTimeout(() => element.classList.remove(PULSE_CLASS), CLEANUP_MS),
    );
  };

  const flyIn = (slot: FeedbackSlot, sprite: SpriteName, start: Vector2): void => {
    const target = slotElement(slot);
    if (!target) return;
    const box = target.getBoundingClientRect();
    const icon = document.createElement("span");
    icon.className = "hud__fly-icon";
    icon.setAttribute("aria-hidden", "true");
    paintIcon(icon, sprite);
    icon.style.setProperty("--fly-from-x", `${start.x}px`);
    icon.style.setProperty("--fly-from-y", `${start.y}px`);
    icon.style.setProperty("--fly-to-x", `${box.left + box.width / 2}px`);
    icon.style.setProperty("--fly-to-y", `${box.top + box.height / 2}px`);
    layer.append(icon);

    let landed = false;
    const land = () => {
      if (landed) return;
      landed = true;
      icon.remove();
      pulse(slot);
    };
    icon.addEventListener("animationend", land, { once: true });
    window.setTimeout(land, CLEANUP_MS);
  };

  return {
    /** `camera` is the player's predicted position, the centre of the screen. */
    play(events: readonly ItemFeedbackEvent[], camera: Vector2) {
      for (const event of events) {
        if (event.type === "use" || reducedMotion()) {
          pulse(event.slot);
          continue;
        }
        const viewport = { width: window.innerWidth, height: window.innerHeight };
        flyIn(event.slot, event.sprite, flyInStart(event.from, camera, viewport, pixelsPerWorldUnit));
      }
    },
  };
}
