import type { HubPipView, HubStatusView } from "../../state/hudView.js";

/**
 * The ready / waiting banner near the hub gate. It is the first card of the notice stack, styled
 * as a toast, so it and the messages under it read as one column. Hidden outside the hub.
 */
export function createHubStatus() {
  const element = document.createElement("div");
  element.className = "hud__toast hud__hub-status";
  element.hidden = true;
  element.setAttribute("role", "status");

  const headline = document.createElement("strong");
  headline.className = "hud__hub-status-text";

  const pips = document.createElement("ul");
  pips.className = "hud__hub-pips";
  pips.setAttribute("aria-label", "Party");

  const detail = document.createElement("span");
  detail.className = "hud__hub-status-detail";

  const hint = document.createElement("span");
  hint.className = "hud__hub-status-hint";
  const hintKey = document.createElement("kbd");
  const hintText = document.createElement("span");
  hint.append(hintKey, hintText);

  element.append(headline, pips, detail, hint);

  // Snapshots arrive many times a second; rebuilding unchanged pips would re-announce the region.
  let renderedPips = "";

  return {
    element,

    update(view: HubStatusView | null) {
      element.hidden = view === null;
      if (!view) return;

      headline.textContent = `${view.ready ? "✓" : "○"} ${view.text}`;
      const pipKey = JSON.stringify(view.pips);
      if (pipKey !== renderedPips) {
        renderedPips = pipKey;
        pips.replaceChildren(...view.pips.map(pipElement));
      }
      detail.textContent = view.detail;
      hintKey.textContent = view.keyHint.key;
      hintText.textContent = view.keyHint.text;
      element.classList.toggle("hud__hub-status--ready", view.ready);
    },
  };
}

function pipElement(pip: HubPipView): HTMLElement {
  const element = document.createElement("li");
  element.className = `hud__hub-pip hud__hub-pip--${pip.state}`;
  element.style.setProperty("--pip-accent", pip.accent);
  element.title = pip.label;
  element.setAttribute("aria-label", pip.label);
  element.textContent = pip.mark;
  return element;
}
