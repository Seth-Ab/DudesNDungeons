import { drawMeterView } from "../../state/bowIndicator.js";

/**
 * The bow's draw meter above the hotbar. It shows the server's fraction (`PlayerState.drawFraction`)
 * as fill length, a tick at the end marking full draw, and a text label that reads "FULL DRAW" at
 * the cap, so the strength never rests on colour alone. Hidden whenever the player is not drawing.
 */
export function createDrawReadout() {
  const element = document.createElement("div");
  element.className = "hud__draw";
  element.hidden = true;
  element.setAttribute("role", "progressbar");
  element.setAttribute("aria-label", "Bow draw");
  element.setAttribute("aria-valuemin", "0");
  element.setAttribute("aria-valuemax", "100");

  const track = document.createElement("div");
  track.className = "hud__draw-track";
  const fill = document.createElement("div");
  fill.className = "hud__draw-fill";
  const tick = document.createElement("div");
  tick.className = "hud__draw-tick";
  track.append(fill, tick);

  const label = document.createElement("div");
  label.className = "hud__draw-label";
  element.append(track, label);

  return {
    element,

    update(fraction: number | null) {
      const view = drawMeterView(fraction);
      element.hidden = view === null;
      if (view === null) return;

      fill.style.width = `${view.percent}%`;
      label.textContent = view.label;
      element.setAttribute("aria-valuenow", String(view.percent));
      element.setAttribute("aria-valuetext", view.full ? "Full draw" : `${view.percent}%`);
      element.classList.toggle("hud__draw--full", view.full);
    },
  };
}
