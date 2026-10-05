import type { RunClockView } from "../../state/hudView.js";

/** The elapsed time and decay countdown at the bottom right. Hidden whenever there is no run. */
export function createRunClock() {
  const element = document.createElement("div");
  element.className = "hud__clock";
  element.hidden = true;
  element.setAttribute("role", "timer");

  const elapsed = document.createElement("span");
  elapsed.className = "hud__clock-elapsed";

  const countdown = document.createElement("span");
  countdown.className = "hud__clock-countdown";

  element.append(elapsed, countdown);

  return {
    element,

    update(view: RunClockView | null) {
      element.hidden = view === null;
      if (!view) return;

      elapsed.textContent = view.elapsed;
      countdown.textContent = view.countdown;
      element.dataset.stage = view.stage;
    },
  };
}
