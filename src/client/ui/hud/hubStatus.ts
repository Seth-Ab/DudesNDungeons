import type { HubStatusView } from "../../state/hudView.js";

/** The ready / waiting banner near the hub gate. Hidden outside the hub. */
export function createHubStatus() {
  const element = document.createElement("div");
  element.className = "hud__hub-status";
  element.hidden = true;
  element.setAttribute("role", "status");

  const headline = document.createElement("strong");
  headline.className = "hud__hub-status-text";

  const detail = document.createElement("span");
  detail.className = "hud__hub-status-detail";

  element.append(headline, detail);

  return {
    element,

    update(view: HubStatusView | null) {
      element.hidden = view === null;
      if (!view) return;

      headline.textContent = `${view.ready ? "✓" : "○"} ${view.text}`;
      detail.textContent = view.detail;
      element.classList.toggle("hud__hub-status--ready", view.ready);
    },
  };
}
