import { vitalChange } from "../../state/hudView.js";

/** A brief red edge flash over the whole screen when the local player's health drops. */
export function createDamageVignette() {
  const element = document.createElement("div");
  element.className = "hud__vignette";
  element.setAttribute("aria-hidden", "true");

  let previousHealth: number | null = null;

  return {
    element,

    /** `health` is the raw number; null when there is no local player. */
    update(health: number | null) {
      if (vitalChange(previousHealth, health) === "damage") {
        // Re-triggers the animation even when a second hit lands before the first has faded.
        element.classList.remove("hud__vignette--flash");
        void element.offsetWidth;
        element.classList.add("hud__vignette--flash");
      }
      previousHealth = health;
    },
  };
}
