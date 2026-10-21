import type { RunClockView } from "../../state/hudView.js";

/**
 * The torch tally under the minimap: a torch that burns down toward the decay window. It draws no
 * digits; the exact times are in the accessible label and title. Hidden whenever there is no run.
 */
export function createRunClock() {
  const element = document.createElement("div");
  element.className = "hud__tally";
  element.hidden = true;
  element.setAttribute("role", "timer");

  const torch = document.createElement("span");
  torch.className = "hud__tally-torch";
  torch.setAttribute("aria-hidden", "true");

  const track = document.createElement("span");
  track.className = "hud__tally-track";
  track.setAttribute("aria-hidden", "true");
  const fill = document.createElement("span");
  fill.className = "hud__tally-fill";
  track.append(fill);

  const status = document.createElement("span");
  status.className = "hud__tally-status";
  status.setAttribute("aria-hidden", "true");

  element.append(torch, track, status);

  return {
    element,

    update(view: RunClockView | null) {
      element.hidden = view === null;
      if (!view) return;

      element.setAttribute("aria-label", view.label);
      element.title = view.label;
      element.dataset.stage = view.stage;
      fill.style.width = `${Math.round(view.ratio * 100)}%`;
      status.textContent = view.status ? `${view.mark} ${view.status}` : "";
      status.hidden = view.status === "";
    },
  };
}
