/**
 * A bare bar that fills as the held bow is drawn. A stand-in until the draw indicator has its own
 * art and layout: it shows the server's fraction (`PlayerState.drawFraction`) and nothing else,
 * and is hidden whenever the player is not drawing.
 */
export function createDrawReadout() {
  const element = document.createElement("div");
  element.className = "hud__draw";
  element.hidden = true;
  element.setAttribute("role", "progressbar");
  element.setAttribute("aria-label", "Bow draw");
  element.setAttribute("aria-valuemin", "0");
  element.setAttribute("aria-valuemax", "100");

  const fill = document.createElement("div");
  fill.className = "hud__draw-fill";
  element.append(fill);

  return {
    element,

    update(fraction: number | null) {
      element.hidden = fraction === null;
      if (fraction === null) return;

      const percent = Math.round(fraction * 100);
      fill.style.width = `${percent}%`;
      element.setAttribute("aria-valuenow", String(percent));
      element.classList.toggle("hud__draw--full", fraction >= 1);
    },
  };
}
